import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { Server } from "http";

/**
 * Issue #1080 — checkRatesFreshness() was only invoked once at module load,
 * so a long-running process that started before RATES_VALID_UNTIL and kept
 * running past it (no restart) never re-checked and never warned.
 */

vi.mock("dotenv/config", () => ({}));
vi.mock("../../../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.invalid/facilitator",
}));
vi.mock("../../../shared/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("checkRatesFreshness periodic re-check (Issue #1080)", () => {
  let server: Server;
  let logger: { warn: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));

    process.env.BILL_PROVIDER_PUBLIC_KEY = "GPUB123TEST";
    process.env.BILL_AUDIT_API_PORT = "0";

    ({ logger } = (await import("../../../shared/logger.ts")) as any);
    const mod = await import("../server.ts");
    server = mod.server;
  });

  afterAll(() => {
    server?.close();
    vi.useRealTimers();
  });

  it("does not warn at boot while rates are still valid (Existing boot check preserved)", () => {
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs a staleness warning after RATES_VALID_UNTIL elapses, without a restart", () => {
    vi.setSystemTime(new Date("2027-01-15T00:00:00Z"));
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ validUntil: "2026-12-31" }),
      expect.stringContaining("stale"),
    );
  });
});

describe("checkRatesFreshness interval does not keep the process alive (Issue #1080)", () => {
  let server: Server;
  let unrefSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    vi.resetModules();
    process.env.BILL_PROVIDER_PUBLIC_KEY = "GPUB123TEST";
    process.env.BILL_AUDIT_API_PORT = "0";

    unrefSpy = vi.fn();
    const realSetInterval = global.setInterval;
    vi.spyOn(global, "setInterval").mockImplementation((...args: any[]) => {
      const timer = (realSetInterval as any)(...args);
      timer.unref = unrefSpy.mockImplementation(() => timer);
      return timer;
    });

    const mod = await import("../server.ts");
    server = mod.server;
  });

  afterAll(() => {
    server?.close();
    vi.restoreAllMocks();
  });

  it("calls .unref() on the freshness-check interval", () => {
    expect(unrefSpy).toHaveBeenCalled();
  });
});
