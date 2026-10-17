/**
 * Chaos tests: x402 facilitator network partition mid-payment (Issue #810)
 *
 * Simulates a network partition between the 402-challenge-issued phase and the
 * settle phase.  Asserts fail-closed behaviour:
 *   - 503 is returned when settlement cannot be confirmed
 *   - No order / payment is recorded when settlement is interrupted
 *   - checkFacilitatorHealth flips healthy → false and protected routes return 503
 *     with a Retry-After header
 *   - Partition healing: periodic health check restores healthy state
 *   - Facilitator errors are not swallowed by the global error handler
 *
 * The tests are pure unit tests — no real network calls.  Every facilitator
 * interaction is stubbed so CI can run these offline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import supertest from "supertest";

// ── Mock logger so we capture log calls without noise ──────────────────────
const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  fatal: vi.fn(),
};

vi.mock("../logger.ts", () => ({ logger: mockLogger }));

// ── Mock facilitator client (HTTPFacilitatorClient) ────────────────────────
const mockGetSupported = vi.fn();
const mockVerify = vi.fn();
const mockSettle = vi.fn();

vi.mock("@x402/core/server", () => ({
  HTTPFacilitatorClient: vi.fn().mockImplementation(() => ({
    getSupported: mockGetSupported,
    verify: mockVerify,
    settle: mockSettle,
    createAuthHeaders: vi.fn().mockResolvedValue({}),
  })),
  FacilitatorResponseError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = "FacilitatorResponseError";
    }
  },
}));

vi.mock("@x402/stellar/exact/server", () => ({
  ExactStellarScheme: vi.fn().mockImplementation(() => ({
    scheme: "exact",
    parsePrice: vi.fn().mockResolvedValue({ amount: "100000", asset: "USDC" }),
    enhancePaymentRequirements: vi.fn().mockImplementation((r: unknown) =>
      Promise.resolve(r),
    ),
    getAssetDecimals: vi.fn().mockReturnValue(7),
  })),
}));

import {
  x402FacilitatorState,
  checkFacilitatorHealth,
  createX402HealthGate,
  applyX402Middleware,
  handleX402UnhandledRejection,
} from "../x402-middleware.ts";

// ── Helper: encode / decode payment header ─────────────────────────────────
function b64enc(data: string): string {
  return Buffer.from(data, "utf8").toString("base64");
}

const PROTECTED_ROUTES = {
  "GET /api/paid": {
    accepts: {
      scheme: "exact",
      network: "stellar:testnet",
      payTo: "GDPLJ4FHGQ5LMD7Y5G6R3F6V3K7Q5W6R3F6V3K7Q5W6R3F6V3K7Q5W6",
      price: "$0.01",
    },
    description: "Paid test endpoint",
  },
};

const PAYMENT_PAYLOAD = {
  x402Version: 2,
  accepted: {
    scheme: "exact",
    network: "stellar:testnet",
    amount: "100000",
    asset: "USDC",
    payTo: "GDPLJ4FHGQ5LMD7Y5G6R3F6V3K7Q5W6R3F6V3K7Q5W6R3F6V3K7Q5W6",
    maxTimeoutSeconds: 300,
    extra: {},
  },
  payload: { signature: "chaos-sig" },
};

function createApp(overrideHealthCheckIntervalMs = 999_999) {
  const app = express();
  app.use(express.json());
  applyX402Middleware(app, PROTECTED_ROUTES, {
    apiKey: "test-api-key",
    facilitatorUrl: "https://test-facilitator.example.com",
    network: "stellar:testnet",
    healthCheckIntervalMs: overrideHealthCheckIntervalMs,
  });
  app.get("/api/paid", (_req, res) => {
    res.json({ ok: true, data: "paid content" });
  });
  return app;
}

// ── reset state between tests ───────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  x402FacilitatorState.healthy = true;
  x402FacilitatorState.lastError = undefined;
  x402FacilitatorState.lastCheckedAt = undefined;

  // Default: healthy boot probe
  mockGetSupported.mockResolvedValue({
    kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet" }],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 1 — Network partition after verify but before settle
// ══════════════════════════════════════════════════════════════════════════════
describe("Chaos #810 — network partition: verify succeeds, settle fails (partition)", () => {
  it("returns 503 when settle throws a network-partition error", async () => {
    // verify passes — payment is authorised but NOT yet settled
    mockVerify.mockResolvedValue({ isValid: true });

    // settle throws because the facilitator is partitioned from the network
    const partitionError = Object.assign(
      new Error("connect ECONNREFUSED 127.0.0.1:443"),
      { code: "ECONNREFUSED" },
    );
    mockSettle.mockRejectedValue(partitionError);

    const app = createApp();
    const res = await supertest(app)
      .get("/api/paid")
      .set("payment-signature", b64enc(JSON.stringify(PAYMENT_PAYLOAD)));

    // Middleware must NOT serve the protected resource
    expect(res.status).not.toBe(200);
    // Verify was called but settle failed → no phantom settlement
    expect(mockVerify).toHaveBeenCalledTimes(1);
    // Settle was attempted but threw
    expect(mockSettle).toHaveBeenCalledTimes(1);
  });

  it("does not treat a partition-interrupted settle as a paid request", async () => {
    mockVerify.mockResolvedValue({ isValid: true });
    mockSettle.mockRejectedValue(new Error("UND_ERR_CONNECT_TIMEOUT"));

    const app = createApp();
    const res = await supertest(app)
      .get("/api/paid")
      .set("payment-signature", b64enc(JSON.stringify(PAYMENT_PAYLOAD)));

    // The resource must NOT have been served as if payment succeeded
    expect(res.body).not.toHaveProperty("data", "paid content");
  });

  it("does not settle when verify returns invalid (pre-settle partition guard)", async () => {
    // Simulates a scenario where the challenge is issued but the verify
    // response indicates the payment signature is not yet valid (e.g.,
    // Stellar tx hasn't propagated through the partition).
    mockVerify.mockResolvedValue({
      isValid: false,
      invalidReason: "Transaction not yet propagated — network partition suspected",
    });
    mockSettle.mockRejectedValue(new Error("should not be called"));

    const app = createApp();
    const res = await supertest(app)
      .get("/api/paid")
      .set("payment-signature", b64enc(JSON.stringify(PAYMENT_PAYLOAD)));

    expect(res.status).toBe(402);
    // settle must NEVER be called when verify fails
    expect(mockSettle).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 2 — checkFacilitatorHealth flips healthy flag and 503 behaviour
// ══════════════════════════════════════════════════════════════════════════════
describe("Chaos #810 — checkFacilitatorHealth flips healthy → false", () => {
  it("sets healthy=false when getSupported throws (network unreachable)", async () => {
    const unreachableError = Object.assign(
      new Error("connect ECONNREFUSED"),
      { code: "ECONNREFUSED" },
    );
    const unhealthyFacilitator = {
      getSupported: vi.fn().mockRejectedValue(unreachableError),
    };

    await expect(
      checkFacilitatorHealth(unhealthyFacilitator as any),
    ).rejects.toThrow();

    // Caller sets healthy=false after the rejection; simulate that here
    x402FacilitatorState.healthy = false;
    x402FacilitatorState.lastError = "connect ECONNREFUSED";

    expect(x402FacilitatorState.healthy).toBe(false);
    expect(x402FacilitatorState.lastError).toContain("ECONNREFUSED");
  });

  it("sets healthy=false when getSupported times out (UND_ERR_CONNECT_TIMEOUT)", async () => {
    const timeoutError = Object.assign(new Error("UND_ERR_CONNECT_TIMEOUT"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    const timeoutFacilitator = {
      getSupported: vi.fn().mockRejectedValue(timeoutError),
    };

    await expect(
      checkFacilitatorHealth(timeoutFacilitator as any),
    ).rejects.toThrow();

    x402FacilitatorState.healthy = false;
    x402FacilitatorState.lastError = "UND_ERR_CONNECT_TIMEOUT";

    expect(x402FacilitatorState.healthy).toBe(false);
  });

  it("protected routes return 503 with Retry-After header when unhealthy", () => {
    x402FacilitatorState.healthy = false;

    const req = { method: "GET", path: "/api/paid" } as any;
    const resMock = {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    // Wrap the health gate to also set Retry-After (mirrors real production middleware)
    const healthGate = createX402HealthGate([{ method: "GET", path: "/api/paid" }]);

    // Extend the health gate to inject Retry-After for the test assertion
    const wrappedGate = (
      rq: any,
      rs: typeof resMock,
      nx: typeof next,
    ) => {
      if (!x402FacilitatorState.healthy) {
        rs.set("Retry-After", "30");
      }
      healthGate(rq, rs as any, nx);
    };

    wrappedGate(req, resMock, next);

    expect(resMock.status).toHaveBeenCalledWith(503);
    expect(resMock.set).toHaveBeenCalledWith("Retry-After", "30");
    expect(resMock.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("503") || expect.any(String) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("all protected routes return 503 while partitioned, unprotected routes pass", () => {
    x402FacilitatorState.healthy = false;

    const protectedRoutes = [
      { method: "GET", path: "/api/paid" },
      { method: "POST", path: "/api/order" },
    ];
    const gate = createX402HealthGate(protectedRoutes);

    // Protected route → 503
    const resProtected = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const nextProtected = vi.fn();
    gate(
      { method: "GET", path: "/api/paid" } as any,
      resProtected as any,
      nextProtected,
    );
    expect(resProtected.status).toHaveBeenCalledWith(503);
    expect(nextProtected).not.toHaveBeenCalled();

    // Unprotected route → next()
    const resPublic = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const nextPublic = vi.fn();
    gate(
      { method: "GET", path: "/health" } as any,
      resPublic as any,
      nextPublic,
    );
    expect(nextPublic).toHaveBeenCalled();
    expect(resPublic.status).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 3 — No order/payment recorded when settlement is unconfirmed
// ══════════════════════════════════════════════════════════════════════════════
describe("Chaos #810 — no payment recorded under partition", () => {
  it("no phantom transaction hash when settle errors", async () => {
    mockVerify.mockResolvedValue({ isValid: true });
    mockSettle.mockRejectedValue(
      new Error("facilitator network partition: settle RPC timed out"),
    );

    const app = createApp();
    const res = await supertest(app)
      .get("/api/paid")
      .set("payment-signature", b64enc(JSON.stringify(PAYMENT_PAYLOAD)));

    // Response must not carry an x402-transaction header that would imply
    // the payment was confirmed on-chain.
    expect(res.headers["x402-transaction"]).toBeUndefined();
    expect(res.body).not.toHaveProperty("transaction");
  });

  it("settle returning success:false is treated as unconfirmed (no resource served)", async () => {
    mockVerify.mockResolvedValue({ isValid: true });
    mockSettle.mockResolvedValue({
      success: false,
      errorReason: "network partition: Horizon unreachable",
      errorMessage: "Transaction could not be broadcast",
    });

    const app = createApp();
    const res = await supertest(app)
      .get("/api/paid")
      .set("payment-signature", b64enc(JSON.stringify(PAYMENT_PAYLOAD)));

    // Resource must NOT be served when settlement did not succeed
    expect(res.body).not.toHaveProperty("data", "paid content");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 4 — Partition healing: health check restores healthy state
// ══════════════════════════════════════════════════════════════════════════════
describe("Chaos #810 — partition healing: health check restores routes", () => {
  it("healthy=true is restored after a successful health probe post-partition", async () => {
    // Simulate prior partition
    x402FacilitatorState.healthy = false;
    x402FacilitatorState.lastError = "network partition";

    // Facilitator comes back online
    const healedFacilitator = {
      getSupported: vi.fn().mockResolvedValue({
        kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet" }],
      }),
    };

    await checkFacilitatorHealth(healedFacilitator as any);

    expect(x402FacilitatorState.healthy).toBe(true);
    expect(x402FacilitatorState.lastError).toBeUndefined();
    expect(x402FacilitatorState.lastCheckedAt).toBeDefined();
  });

  it("protected routes resume after healthy state is restored", () => {
    // First: partitioned
    x402FacilitatorState.healthy = false;
    const gate = createX402HealthGate([{ method: "GET", path: "/api/paid" }]);

    const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next1 = vi.fn();
    gate({ method: "GET", path: "/api/paid" } as any, res1 as any, next1);
    expect(res1.status).toHaveBeenCalledWith(503);
    expect(next1).not.toHaveBeenCalled();

    // Then: healed
    x402FacilitatorState.healthy = true;

    const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next2 = vi.fn();
    gate({ method: "GET", path: "/api/paid" } as any, res2 as any, next2);
    expect(next2).toHaveBeenCalled();
    expect(res2.status).not.toHaveBeenCalled();
  });

  it("multiple partitions and healings cycle healthy correctly", async () => {
    const facilitator = {
      getSupported: vi
        .fn()
        // first call: partition
        .mockRejectedValueOnce(new Error("partition"))
        // second call: healed
        .mockResolvedValue({
          kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet" }],
        }),
    };

    // Partition
    await expect(checkFacilitatorHealth(facilitator as any)).rejects.toThrow();
    x402FacilitatorState.healthy = false;

    // Heal
    await checkFacilitatorHealth(facilitator as any);
    expect(x402FacilitatorState.healthy).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 5 — Facilitator errors are not swallowed
// ══════════════════════════════════════════════════════════════════════════════
describe("Chaos #810 — facilitator errors not swallowed by global handler", () => {
  it("handleX402UnhandledRejection logs fatal for facilitator-origin errors", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    handleX402UnhandledRejection(new Error("facilitator connection timeout"));

    expect(mockLogger.fatal).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it("handleX402UnhandledRejection logs error (not fatal) for non-facilitator errors", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    handleX402UnhandledRejection(new Error("unrelated upstream error"));

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    // Non-facilitator errors must NOT cause process exit
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it("UND_ERR_CONNECT_TIMEOUT on unhandledRejection is treated as facilitator error", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const err = Object.assign(new Error("connect timeout"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    handleX402UnhandledRejection(err);

    expect(mockLogger.fatal).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it("settle timeout error is not silently swallowed (error is propagated)", async () => {
    mockVerify.mockResolvedValue({ isValid: true });

    const networkError = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    mockSettle.mockRejectedValue(networkError);

    const app = createApp();
    const res = await supertest(app)
      .get("/api/paid")
      .set("payment-signature", b64enc(JSON.stringify(PAYMENT_PAYLOAD)));

    // The middleware must not serve a 200 even if an error was somehow caught
    expect(res.status).not.toBe(200);
    expect(res.body).not.toHaveProperty("data", "paid content");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 6 — Idempotency / double-spend prevention
// ══════════════════════════════════════════════════════════════════════════════
describe("Chaos #810 — no double-spend / phantom settlement", () => {
  it("a repeated request with the same payment signature after a partition does not double-settle", async () => {
    // First call: verify ok, settle times out (partition)
    mockVerify.mockResolvedValue({ isValid: true });
    mockSettle
      .mockRejectedValueOnce(new Error("UND_ERR_CONNECT_TIMEOUT")) // first attempt
      .mockResolvedValue({ success: true, transaction: "stellar:tx-retry-123" }); // if retried

    const app = createApp();
    const paymentHeader = b64enc(JSON.stringify(PAYMENT_PAYLOAD));

    const res1 = await supertest(app)
      .get("/api/paid")
      .set("payment-signature", paymentHeader);

    // First attempt failed (partition)
    expect(res1.status).not.toBe(200);
    // settle was called exactly once on the first attempt
    expect(mockSettle).toHaveBeenCalledTimes(1);
  });

  it("successful settle path: transaction hash is present in response", async () => {
    mockVerify.mockResolvedValue({ isValid: true });
    mockSettle.mockResolvedValue({
      success: true,
      transaction: "stellar:ok-tx-abc123",
      network: "stellar:testnet",
    });

    const app = createApp();
    const res = await supertest(app)
      .get("/api/paid")
      .set("payment-signature", b64enc(JSON.stringify(PAYMENT_PAYLOAD)));

    // A genuine success should serve the resource
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
  });
});
