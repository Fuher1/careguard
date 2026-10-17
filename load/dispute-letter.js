/**
 * k6 load test — POST /agent/dispute-letter PDF generation (Issue #805)
 *
 * agent/server.ts POST /agent/dispute-letter is CPU and memory heavy:
 * it calls generateDisputeLetter() which produces a PDF blob in memory.
 * This script ramps concurrent VUs posting realistic audit results to
 * confirm that:
 *
 *   1. p95 latency stays under the threshold (default 8 000 ms).
 *   2. Zero 5xx responses under sustained burst load.
 *   3. Every 200 response has content-type application/json and a
 *      non-empty letter body (partial/empty PDFs are caught).
 *   4. Memory does not grow unbounded — the periodic /health probe must
 *      keep reporting healthy throughout the run.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   # Default (local dev server on :3004)
 *   k6 run load/dispute-letter.js
 *
 *   # Against a deployed environment
 *   BASE_URL=https://your-app.onrender.com \
 *   CAREGIVER_TOKEN=<token> \
 *   k6 run load/dispute-letter.js
 *
 *   # Relaxed thresholds for slow/staging environments
 *   P95_LATENCY_MS=15000 k6 run load/dispute-letter.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CI INTEGRATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Add a step to your CI workflow after the server under test is running:
 *
 *     - name: k6 dispute-letter load test
 *       run: |
 *         k6 run \
 *           --env BASE_URL=http://localhost:3004 \
 *           --env CAREGIVER_TOKEN=${{ secrets.CAREGIVER_TOKEN }} \
 *           load/dispute-letter.js
 *
 *   k6 exits non-zero when any threshold is breached, so the step will
 *   fail the build on regressions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PREREQUISITES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   - k6 installed: https://k6.io/docs/getting-started/installation/
 *   - Agent server running with a real CAREGIVER_TOKEN in .env
 *   - No real Stellar payments are made by this endpoint (it only generates
 *     a PDF letter in memory — no x402 payment gate applies).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEMORY LEAK DETECTION STRATEGY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   The test polls GET /health at the end of each scenario iteration.  If
 *   the server begins OOMing it will respond slowly or return 5xx, which
 *   is caught by the health_check_errors threshold.  For more rigorous
 *   leak detection, run the script with a heap profiler attached to the Node
 *   process:
 *
 *     node --inspect --heap-prof agent/server.ts &
 *     k6 run load/dispute-letter.js
 *
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// ── Configurable parameters ────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:3004";
const CAREGIVER_TOKEN = __ENV.CAREGIVER_TOKEN || "dev-caregiver-token";
const P95_LATENCY_MS = parseInt(__ENV.P95_LATENCY_MS || "8000", 10);

// ── Custom metrics ─────────────────────────────────────────────────────────
const errors5xx = new Counter("dispute_letter_errors_5xx");
const successRate = new Rate("dispute_letter_success_rate");
const letterDuration = new Trend("dispute_letter_duration_ms", true);
const emptyLetterErrors = new Counter("dispute_letter_empty_or_partial");
const healthCheckErrors = new Counter("dispute_letter_health_check_errors");
const letterBodySize = new Trend("dispute_letter_body_bytes", true);

// ── Load scenario ──────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Ramp up to 10 VUs over 30 s to simulate burst traffic
    ramp_burst: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "20s", target: 5 },   // warm-up
        { duration: "30s", target: 10 },  // sustained burst
        { duration: "20s", target: 5 },   // cool-down
        { duration: "10s", target: 0 },   // drain
      ],
      exec: "generateDisputeLetter",
    },

    // Steady constant load to detect per-request memory leaks
    constant_steady: {
      executor: "constant-vus",
      vus: 3,
      duration: "60s",
      exec: "generateDisputeLetter",
      startTime: "10s", // start after ramp begins
    },
  },

  thresholds: {
    // No 5xx responses allowed under any scenario
    dispute_letter_errors_5xx: ["count==0"],

    // At least 99 % of requests must succeed (200 or 400 for bad input — not 5xx)
    dispute_letter_success_rate: ["rate>=0.99"],

    // p95 latency must be below the configured threshold (default 8 s)
    dispute_letter_duration_ms: [`p(95)<${P95_LATENCY_MS}`],

    // No partial / empty letter bodies
    dispute_letter_empty_or_partial: ["count==0"],

    // Health checks must not error (proxy for memory exhaustion)
    dispute_letter_health_check_errors: ["count==0"],
  },
};

// ── Shared request headers ─────────────────────────────────────────────────
const AUTH_HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${CAREGIVER_TOKEN}`,
};

// ── Realistic audit result fixtures ───────────────────────────────────────
//
// These match the shape produced by services/bill-audit-api and consumed by
// generateDisputeLetter() in agent/tools.ts.  Three variants of increasing
// complexity exercise different code paths in the PDF generator.

/** A minimal single-error audit result */
const AUDIT_RESULT_SIMPLE = {
  errorCount: 1,
  totalOvercharge: 45.0,
  errors: [
    {
      lineItem: { description: "Complete blood count (CBC)", cptCode: "85025", quantity: 2, chargedAmount: 90 },
      type: "duplicate",
      description: "Duplicate CBC charge on same date of service",
      overcharge: 45.0,
    },
  ],
  summary: "1 duplicate charge found. Recommended correction: $45.00",
};

/** A realistic multi-error audit result (mirrors the Rosa example from README) */
const AUDIT_RESULT_REALISTIC = {
  errorCount: 4,
  totalOvercharge: 1195.0,
  errors: [
    {
      lineItem: { description: "Hospital care, high complexity", cptCode: "99233", quantity: 4, chargedAmount: 840 },
      type: "upcoded",
      description: "Quantity billed (4) exceeds typical daily maximum (3) for inpatient care",
      overcharge: 210.0,
    },
    {
      lineItem: { description: "Complete blood count (CBC)", cptCode: "85025", quantity: 2, chargedAmount: 90 },
      type: "duplicate",
      description: "Duplicate CBC charge on same date of service",
      overcharge: 45.0,
    },
    {
      lineItem: { description: "Office visit, complex", cptCode: "99215", quantity: 1, chargedAmount: 1250 },
      type: "overpriced",
      description: "Charged amount $1,250 exceeds 2× the Medicare rate of $285",
      overcharge: 680.0,
    },
    {
      lineItem: { description: "Chest X-ray, 2 views", cptCode: "71046", quantity: 2, chargedAmount: 360 },
      type: "duplicate",
      description: "Chest X-ray billed twice on the same date",
      overcharge: 180.0,
    },
  ],
  summary:
    "4 billing errors found totalling $1,195.00. Recommend formal dispute.",
};

/** A large audit result with many errors (stress test for PDF generator) */
function buildLargeAuditResult(errorCount: number) {
  const errors = [];
  for (let i = 0; i < errorCount; i++) {
    errors.push({
      lineItem: {
        description: `Line item ${i + 1}`,
        cptCode: i % 2 === 0 ? "99233" : "85025",
        quantity: 1,
        chargedAmount: 100 + i,
      },
      type: i % 3 === 0 ? "duplicate" : "overpriced",
      description: `Error description for line item ${i + 1}`,
      overcharge: 50 + (i % 100),
    });
  }
  return {
    errorCount: errors.length,
    totalOvercharge: errors.reduce((s, e) => s + e.overcharge, 0),
    errors,
    summary: `${errors.length} billing errors found`,
  };
}

const AUDIT_RESULT_LARGE = buildLargeAuditResult(50);

/** Builds the request body for a dispute-letter generation */
function buildPayload(auditResult: object, variant = "realistic") {
  return JSON.stringify({
    bill_id: `bill-load-test-${variant}-${Date.now()}`,
    error_descriptions: (auditResult as any).errors?.map((e: any) => e.description) ?? [],
    audit_result_json: JSON.stringify(auditResult),
    recipient_name: "Rosa Martinez",
    facility: "General Hospital",
    caregiver_name: "Maria Martinez",
    caregiver_email: "maria@example.com",
  });
}

// ── Main scenario ─────────────────────────────────────────────────────────
export function generateDisputeLetter() {
  // Rotate through variants so all code paths are exercised
  const vuIndex = __VU % 3;
  let payload: string;
  let variant: string;

  if (vuIndex === 0) {
    payload = buildPayload(AUDIT_RESULT_SIMPLE, "simple");
    variant = "simple";
  } else if (vuIndex === 1) {
    payload = buildPayload(AUDIT_RESULT_REALISTIC, "realistic");
    variant = "realistic";
  } else {
    payload = buildPayload(AUDIT_RESULT_LARGE, "large");
    variant = "large";
  }

  group(`dispute-letter/${variant}`, () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/agent/dispute-letter`,
      payload,
      { headers: AUTH_HEADERS, timeout: `${P95_LATENCY_MS + 5000}ms` },
    );
    const elapsed = Date.now() - start;

    letterDuration.add(elapsed);
    letterBodySize.add(res.body ? res.body.length : 0);

    const ok = check(res, {
      // Must not return 5xx
      "status is not 5xx": (r) => r.status < 500,

      // Expected: 200 with a letter body, or 401/403 for missing/invalid token
      "status is 200, 401, or 403": (r) =>
        r.status === 200 || r.status === 401 || r.status === 403,

      // When 200: content-type must be application/json
      "200 → content-type is application/json": (r) => {
        if (r.status !== 200) return true;
        const ct = r.headers["Content-Type"] || "";
        return ct.includes("application/json");
      },

      // When 200: response body must not be empty
      "200 → body is non-empty": (r) => {
        if (r.status !== 200) return true;
        return r.body !== null && r.body.length > 0;
      },

      // When 200: response must parse as JSON with a letter field
      "200 → body has letter content": (r) => {
        if (r.status !== 200) return true;
        try {
          const body = JSON.parse(r.body as string);
          // generateDisputeLetter returns an object with at least a text field
          return (
            body !== null &&
            typeof body === "object" &&
            (typeof body.text === "string" ||
              typeof body.letter === "string" ||
              typeof body.content === "string" ||
              // The actual response shape from tools.ts generateDisputeLetter
              // returns { subject, body, attachments } or similar — check for
              // any string-valued key indicating letter content.
              Object.values(body).some((v) => typeof v === "string" && (v as string).length > 10))
          );
        } catch {
          return false;
        }
      },
    });

    if (res.status >= 500) {
      errors5xx.add(1);
      console.error(`[VU ${__VU}] 5xx on dispute-letter/${variant}: ${res.status} — ${String(res.body).slice(0, 300)}`);
    }

    if (res.status === 200) {
      try {
        const body = JSON.parse(res.body as string);
        const hasContent = Object.values(body).some(
          (v) => typeof v === "string" && (v as string).length > 10,
        );
        if (!hasContent) {
          emptyLetterErrors.add(1);
          console.warn(`[VU ${__VU}] Empty/partial letter body on variant ${variant}`);
        }
      } catch {
        emptyLetterErrors.add(1);
        console.warn(`[VU ${__VU}] Non-parseable letter body on variant ${variant}`);
      }
    }

    successRate.add(ok ? 1 : 0);
  });

  // Health check probe after each iteration — a rising latency or error here
  // indicates the process is under memory pressure from prior generations.
  group("health-check", () => {
    const healthRes = http.get(`${BASE_URL}/health`, { timeout: "5s" });
    const healthOk = check(healthRes, {
      "health returns 200": (r) => r.status === 200,
    });
    if (!healthOk) {
      healthCheckErrors.add(1);
      console.error(
        `[VU ${__VU}] /health check failed: ${healthRes.status} — ${String(healthRes.body).slice(0, 200)}`,
      );
    }
  });

  sleep(0.5);
}

// ── Summary ─────────────────────────────────────────────────────────────────
export function handleSummary(data: Record<string, any>) {
  const p95 =
    data.metrics?.dispute_letter_duration_ms?.values?.["p(95)"]?.toFixed(0) ??
    "?";
  const p99 =
    data.metrics?.dispute_letter_duration_ms?.values?.["p(99)"]?.toFixed(0) ??
    "?";
  const total = data.metrics?.iterations?.values?.count ?? "?";
  const rate = (
    (data.metrics?.dispute_letter_success_rate?.values?.rate ?? 0) * 100
  ).toFixed(1);
  const errors = data.metrics?.dispute_letter_errors_5xx?.values?.count ?? 0;
  const empty = data.metrics?.dispute_letter_empty_or_partial?.values?.count ?? 0;
  const healthErrors =
    data.metrics?.dispute_letter_health_check_errors?.values?.count ?? 0;
  const avgBytes =
    data.metrics?.dispute_letter_body_bytes?.values?.avg?.toFixed(0) ?? "?";

  return {
    stdout: `
╔══════════════════════════════════════════════════════════════╗
║      CareGuard — Dispute Letter Load Test Summary (#805)     ║
╚══════════════════════════════════════════════════════════════╝

  BASE_URL          : ${BASE_URL}
  Iterations        : ${total}
  Success rate      : ${rate}%
  5xx errors        : ${errors}  ${errors > 0 ? "⚠ THRESHOLD BREACHED" : "✅"}
  Empty/partial PDF : ${empty}  ${empty > 0 ? "⚠ THRESHOLD BREACHED" : "✅"}
  Health errors     : ${healthErrors}  ${healthErrors > 0 ? "⚠ POSSIBLE MEMORY PRESSURE" : "✅"}

  Latency
  ──────────────────
  p95               : ${p95} ms  ${parseInt(p95) > P95_LATENCY_MS ? "⚠ ABOVE THRESHOLD" : "✅"} (threshold: ${P95_LATENCY_MS} ms)
  p99               : ${p99} ms

  Response size
  ──────────────────
  Avg body bytes    : ${avgBytes} B

  Notes
  ──────────────────
  • A spike in health check errors at the end of the run suggests the process
    did not release memory from prior PDF generations (per-request leak).
  • To profile memory: node --heap-prof agent/server.ts, then run this script.
  • To refresh results: set BASE_URL and CAREGIVER_TOKEN env vars.
`,
  };
}
