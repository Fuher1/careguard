import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";

/**
 * Issue #1081 — the unified server (server.ts) and the standalone
 * pharmacy-api (services/pharmacy-api/server.ts) each hand-wrote their own
 * Bearer-token admin check. Both now delegate to the shared
 * createPharmacyAdminAuth factory (shared/pharmacy-admin-auth.ts), which
 * uses safeCompare instead of !==. This test confirms both entrypoints
 * reject an invalid admin token consistently.
 */

vi.spyOn(Keypair, "fromSecret").mockImplementation(() => {
  return {
    publicKey: () => "GBQTESTPHARMACY1",
    secret: () => "mock-secret",
  } as any;
});

vi.mock("../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.test/x402",
}));

// Mock env vars before importing server.ts to satisfy z.object schema validation
process.env.LLM_API_KEY = "mock-key";
process.env.AGENT_SECRET_KEY = "S-mock-secret";
process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTPHARMACY2";
process.env.MPP_SECRET_KEY = "S-mock-secret";
process.env.CAREGIVER_TOKEN = "mock-token";
process.env.PHARMACY_ADMIN_TOKEN = "shared-admin-token";

// Dynamic imports to ensure env vars are set first
const { app: unifiedApp } = await import("../server.ts");
const { createPharmacyApp } = await import("../services/pharmacy-api/server.ts");

describe("pharmacy admin auth consistency across entrypoints", () => {
  let standaloneApp: any;

  beforeEach(() => {
    standaloneApp = createPharmacyApp({
      payTo: "GBQTESTPHARMACY1",
      adminToken: "shared-admin-token",
      enablePayments: false,
    }).app;
  });

  it("rejects a missing admin token with 401 on both entrypoints", async () => {
    const unifiedRes = await request(unifiedApp)
      .post("/pharmacy/drugs")
      .send({ name: "test-drug" });
    const standaloneRes = await request(standaloneApp)
      .post("/pharmacy/drugs")
      .send({ name: "test-drug" });

    expect(unifiedRes.status).toBe(401);
    expect(standaloneRes.status).toBe(401);
    expect(unifiedRes.body).toEqual({ error: "Missing admin token" });
    expect(standaloneRes.body).toEqual({ error: "Missing admin token" });
  });

  it("rejects an invalid admin token with 403 on both entrypoints", async () => {
    const unifiedRes = await request(unifiedApp)
      .post("/pharmacy/drugs")
      .set("Authorization", "Bearer wrong-token")
      .send({ name: "test-drug" });
    const standaloneRes = await request(standaloneApp)
      .post("/pharmacy/drugs")
      .set("Authorization", "Bearer wrong-token")
      .send({ name: "test-drug" });

    expect(unifiedRes.status).toBe(403);
    expect(standaloneRes.status).toBe(403);
    expect(unifiedRes.body).toEqual({ error: "Invalid admin token" });
    expect(standaloneRes.body).toEqual({ error: "Invalid admin token" });
  });

  it("accepts the correct admin token on both entrypoints", async () => {
    const unifiedRes = await request(unifiedApp)
      .post("/pharmacy/drugs")
      .set("Authorization", "Bearer shared-admin-token")
      .send({ name: "test-drug", displayName: "Test Drug", defaultDosage: "10mg" });
    const standaloneRes = await request(standaloneApp)
      .post("/pharmacy/drugs")
      .set("Authorization", "Bearer shared-admin-token")
      .send({ name: "test-drug-2", displayName: "Test Drug 2", defaultDosage: "10mg" });

    expect(unifiedRes.status).toBe(201);
    expect(standaloneRes.status).toBe(201);
  });
});
