import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Issue #1082 — pharmacy-api was the only payment-adjacent service that
 * didn't fail fast when its required public-key env var was missing; it
 * silently produced an undefined defaultPharmacyApp instead. It should now
 * throw at module load, consistent with drug-interaction-api and
 * pharmacy-payment.
 */

vi.mock("dotenv/config", () => ({}));
vi.mock("../../../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.test/x402",
}));

describe("pharmacy-api fail-fast on missing PHARMACY_1_PUBLIC_KEY (Issue #1082)", () => {
  const original = process.env.PHARMACY_1_PUBLIC_KEY;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.PHARMACY_1_PUBLIC_KEY;
  });

  afterEach(() => {
    process.env.PHARMACY_1_PUBLIC_KEY = original;
  });

  it("throws a clear startup error when PHARMACY_1_PUBLIC_KEY is unset", async () => {
    await expect(import("../server.ts")).rejects.toThrow(
      "PHARMACY_1_PUBLIC_KEY required in .env",
    );
  });

  it("boots normally and exposes a defined defaultPharmacyApp when the env var is set", async () => {
    process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1";
    const mod = await import("../server.ts");
    expect(mod.defaultPharmacyApp).toBeDefined();
    expect(mod.defaultPharmacyApp.app).toBeDefined();
  });
});
