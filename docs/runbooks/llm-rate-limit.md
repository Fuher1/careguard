# Runbook: LLM Provider Rate Limit (429)

**Symptom**

There are **two distinct 429s** in CareGuard — this runbook is about the
first one; don't confuse them:

1. **LLM provider rate limit (Groq/OpenAI-compatible 429)** — the LLM API
   itself rejects a request during an in-progress agent run
   (`agent/runner.ts`, the `llm.chat.completions.create()` call). This is
   caught internally and does **not** surface as an HTTP error:
   `POST /agent/run` still responds `200 OK`. What you'll actually observe:
   - The dashboard's **Overview** tab shows a red `role="alert"` banner:
     `⚠ LLM error at iteration <N> — results below are partial`, followed by
     the raw provider error message and, if the provider returned one, an
     error code in parentheses (`dashboard/src/components/tabs/overview-tab.tsx`,
     `LlmErrorBanner`).
   - The **Agent Response** panel directly below repeats the same
     `⚠ LLM error...` text as the run's `response` field.
   - `toolCalls` for the run may be **0** if the 429 hit on the very first
     LLM call (iteration 0, before any tool was chosen) — in that case the
     "partial results" are just the raw error message, since there's
     nothing else to summarize yet. This is a *degraded*, not *empty*,
     response: the runner guarantees `response` is never a blank string on
     an LLM error (see "Current behaviour," below).
   - Server logs contain a `"LLM API error"` entry with the raw provider
     message and the iteration number (`agent/runner.ts`).
2. **CareGuard's own agent-queue 429** — unrelated to the LLM provider.
   Thrown by `shared/agent-queue.ts` when more than `MAX_QUEUE_SIZE`
   (default `10`) requests are already waiting because
   `AGENT_CONCURRENCY` (default `1`) concurrent runs are in flight. This
   **does** return a real `429` HTTP status from `POST /agent/run`, with a
   `Retry-After: 10` header and body `{"error": "Agent queue is full.
   Please try again later."}` (`server.ts`, `agent/server.ts`). It has
   nothing to do with the LLM provider being rate-limited and needs no
   provider switch — it means too many caregiver sessions are hitting this
   one instance at once.

**Impact**

- Only the run that hit the LLM 429 is affected — it terminates at that
  iteration with whatever tool calls already completed. There is no
  automatic retry at this layer (see "Current behaviour").
- **`agent_runs_total{status="success"}` still increments** for a run that
  failed this way, because `runAgent()` resolves normally rather than
  throwing — the failure is reported through the `error` field on an
  otherwise-successful-looking result, not through the request's outcome.
  An operator watching only the "Agent Runs by Status" pie chart
  (`docs/observability/dashboard-guide.md`) will **not** see this incident;
  `agent_llm_error_total` is the metric that actually increments (see
  Diagnosis).
- No USDC is charged and no audit-log entries are lost or corrupted — every
  tool call that completed before the LLM error was already written to
  `data/audit.log.jsonl` via `appendAuditEntry()` before the failure, and
  those entries remain valid.
- If the rate limit is account/org-wide rather than transient per-request
  bursting, every concurrent or subsequent run may hit the same 429 until
  the window resets.

---

## Diagnosis

1. **Check the LLM Errors panel first** — Grafana dashboard `careguard-agent`
   → "LLM Errors" (`agent_llm_error_total`), per
   [`docs/observability/dashboard-guide.md`](../observability/dashboard-guide.md).
   Any nonzero/increasing count means LLM API errors are occurring — this
   metric increments for *any* LLM API failure (429, 5xx, timeout,
   connection error), not only rate limits, so confirm the specific cause
   in logs (next step). Do **not** rely on "Agent Runs by Status" for this —
   see Impact, above.
2. **Grep server logs for `"LLM API error"`** — this is the exact message
   `agent/runner.ts` logs (`logger.error({ err, iteration }, "LLM API
   error")`) on every LLM call failure. The logged `err` field is the raw
   provider error message. For Groq specifically, a 429 body looks like
   `{"error": {"message": "Rate limit reached for model ... Please try
   again in <N>s.", "type": "requests" | "tokens"}}` — confirmed against
   [Groq's error-format documentation](https://console.groq.com/docs/errors)
   (fields `message` and `type`); community-reported responses also include
   a `code: "rate_limit_exceeded"` field, though Groq's own docs page does
   not explicitly enumerate `code` values, so treat that field as usually
   present but not guaranteed. Via the installed `openai` SDK (v6, see
   `package.json`), this becomes a `RateLimitError` with `.status === 429`,
   `.message` prefixed with `"429 "`, and `.code` set from the response
   body's `code` field if the provider sent one (`node_modules/openai/src/core/error.ts`)
   — which is exactly what ends up in the dashboard's error banner and in
   `result.error.code`.
3. **If you have direct access to the provider response headers** (e.g.
   reproducing with `curl` against `LLM_BASE_URL` directly), Groq returns
   `retry-after` (seconds, only present on a 429),
   `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`,
   `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-requests`, and
   `x-ratelimit-reset-tokens` on every response — these tell you exactly
   when the limit resets, per
   [Groq's rate-limits documentation](https://console.groq.com/docs/rate-limits).
4. **Rule out the other 429** — if `POST /agent/run` itself returned HTTP
   429 (not 200 with an `error` field), that's the agent-queue limit, not
   the LLM provider. Check `agent_queue_depth` and `agent_waiting_jobs`
   gauges (`shared/agent-queue.ts`) — if `agent_queue_depth` is pinned at
   `AGENT_CONCURRENCY` and `agent_waiting_jobs` is nonzero, that confirms
   queue exhaustion, not an LLM rate limit. No provider action is needed
   for this case.

**Current behaviour (what the agent actually does today)**

`agent/runner.ts`'s main loop wraps each `llm.chat.completions.create()`
call in a `try/catch`. On any error — a 429 included, with no special
handling per HTTP status — it:

1. Logs the error and increments `agent_llm_error_total` (no retry or
   backoff is attempted at this layer).
2. Sets `result.error = { message, code, iteration }`.
3. Builds `result.response` as `"⚠ LLM error at iteration <N> — results
   below are partial"` followed by a summary of whatever tool calls already
   ran (or the raw error message if none did yet), and breaks the loop.

This is a deliberate design, not incidental: `agent/__tests__/runner-llm-chaos.test.ts`
(Issue #807) is intended to assert exactly this — an LLM failure "returns
explicit error, not empty summary" — i.e. that `result.response` is never a
blank string and `result.error` is always populated, including the
degenerate case of failing on the very first call with zero tool calls
completed. **That specific test file currently fails to run at all** (a
pre-existing `vi.mock` hoisting bug unrelated to this issue — it references
outer `const mockLogger`/`mockAudit` bindings from inside a hoisted
`vi.mock(...)` factory, which throws `ReferenceError: Cannot access
'mockLogger' before initialization` before a single test executes), so it
provides no live regression protection today. Since that test file isn't
named in this issue's scope, it wasn't fixed here — but the underlying
claim was independently re-verified by feeding the real, unmodified
`agent/runner.ts` a genuine `openai` SDK `RateLimitError` (constructed via
the SDK's own `APIError.generate()` with a realistic Groq-shaped body,
`status: 429`) and confirming the actual result: `response` was a 200+
character non-empty string beginning with `"⚠ LLM error at iteration
0"`, and `error` was `{ message: "429 Rate limit reached for model
...", code: "rate_limit_exceeded", iteration: 0 }` — matching this section
exactly, verified against real code execution rather than the (currently
non-functional) test suite.

---

## Mitigation

There is no built-in retry, backoff, or automatic provider fallback for LLM
errors today — confirmed directly from `agent/runner.ts`'s single
`try/catch` around the LLM call (see "Current behaviour," above). The
caregiver-facing UI does not auto-resume a partial run either; the
caregiver must submit the task again from the dashboard.

**Short/transient rate limits (recommended first)**: wait for the window
to reset — Groq's `retry-after` / `x-ratelimit-reset-requests` /
`x-ratelimit-reset-tokens` headers (Diagnosis step 3) tell you exactly how
long — then have the caregiver re-run the same task. No configuration
change is needed.

**Sustained or account-wide rate limits**: if the limit isn't clearing
(e.g. a monthly/organization quota rather than a short per-minute burst),
switch LLM provider or model — see Remediation below.

---

## Remediation — switching LLM provider or model

CareGuard's agent talks to the LLM through the standard `openai` SDK
against an **OpenAI-compatible chat-completions endpoint**, configured
entirely through three environment variables (`docs/agent/llm-config.md`,
which is the authoritative reference for every LLM-related environment
variable this repo supports — this repo does not currently have a
dedicated ADR for the LLM-provider choice itself, so link to that doc, not
an ADR, for the full configuration surface):

```bash
LLM_API_KEY=<key for the target provider>
LLM_BASE_URL=https://api.groq.com/openai/v1   # any OpenAI-compatible base URL
LLM_MODEL=llama-3.3-70b-versatile              # any model the target endpoint serves
```

**This requires a restart — there is no hot-reload.** Both entry points
(`server.ts`, the unified production server, and `agent/server.ts`, the
standalone one) construct the LLM client **once**, at module load:

```ts
const llm = new OpenAI({ apiKey: process.env.LLM_API_KEY, baseURL: LLM_BASE_URL });
const LLM_MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";
```

Unlike the agent wallet key, which does support a live, no-downtime reload
via `SIGHUP` (see [`rotate-render-secrets.md`](rotate-render-secrets.md)),
that `SIGHUP` handler only invalidates the x402 signer/MPP-client cache in
`agent/tools.ts` — there is no equivalent handler for `LLM_API_KEY`,
`LLM_BASE_URL`, or `LLM_MODEL`. A `SIGHUP` will not pick up a changed LLM
provider; the process must actually restart so the module-level `llm` and
`LLM_MODEL` are re-initialized from the new environment.

**Local development**: stop and restart the `node --import tsx server.ts`
process (or `npm run dev`) after editing `.env`.

**Docker Compose**: edit `.env`, then run

```bash
docker compose up -d <service>
```

**not** `docker compose restart` — `restart` reuses the existing container
as-is and does not re-read `.env` or `environment:` values; only `up -d`
recreates the container with the updated environment.

**Render** (`render.yaml`): `LLM_API_KEY` is declared `sync: false`
(dashboard-managed secret, per the same convention documented in
[`rotate-render-secrets.md`](rotate-render-secrets.md)) — update it in the
Render Dashboard under Environment Variables. `LLM_BASE_URL` and
`LLM_MODEL` currently have hardcoded `value:` entries in `render.yaml`
(they are not `sync: false`), so a durable change belongs in `render.yaml`
itself via a normal deploy; a one-off manual override in the Dashboard also
works but can be reverted by a future blueprint sync back to the
`render.yaml` value. Either way, per `rotate-render-secrets.md`, Render
does **not** automatically restart a running service when an environment
variable changes — trigger **Manual Deploy → Restart Service** (or a full
redeploy if `render.yaml` itself changed) for the new value to take effect.

**After switching**: if the new provider/model has meaningfully different
latency, context window, or cost characteristics, revisit the tunables in
[`docs/agent/llm-config.md`](../agent/llm-config.md) — `LLM_TOOL_TEMPERATURE`,
`LLM_SUMMARY_TEMPERATURE`, and the `LLM_MAX_TOKENS_*` budgets were tuned
against Groq's `llama-3.3-70b-versatile` and may not be optimal for a
different model without adjustment.

---

## Post-mortem template

```
Date / duration:
Provider / model at time of incident:
Root cause: [ transient rate limit | sustained quota exhaustion | agent-queue exhaustion (not LLM) ]
Detection lag: (time from first agent_llm_error_total increase to incident declared)
Mitigation taken: [ waited for reset | switched provider/model ]
Remediation:
Action items:
```

---

## Related

- [`docs/agent/llm-config.md`](../agent/llm-config.md) — full LLM environment-variable reference (temperature, token budgets); the closest thing this repo has to an LLM-provider configuration ADR
- [`docs/observability/dashboard-guide.md`](../observability/dashboard-guide.md) — `agent_llm_error_total` ("LLM Errors" panel) and `agent_runs_total` ("Agent Runs by Status") panel definitions
- [`docs/troubleshooting.md`](../troubleshooting.md) — existing one-line pointer for "Groq / LLM provider 429"
- [`rotate-render-secrets.md`](rotate-render-secrets.md) — `SIGHUP` vs. manual-restart precedent this runbook builds on
- `agent/runner.ts` — the LLM-call error handling this runbook documents
- `shared/agent-queue.ts` — CareGuard's own, unrelated 429 (agent-run concurrency queue)
- `agent/__tests__/runner-llm-chaos.test.ts` (Issue #807) — intended regression tests for the explicit-error/non-empty-summary guarantee; currently fails to execute due to a pre-existing, unrelated `vi.mock` hoisting bug (see "Current behaviour," above)
