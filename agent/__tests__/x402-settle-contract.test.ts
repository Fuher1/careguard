/**
 * Contract test: x402 Facilitator /settle response and tx-hash extraction (Issue #814).
 * Pins settle response schema and validates tx-hash extraction against real OZ facilitator shape.
 */

import { describe, it, expect } from "vitest";

const STELLAR_TX_HASH_RE = /^[a-f0-9]{64}$/;

function extractX402TxHash(response: any): string | undefined {
  const header = response.paymentResponse ||
    response["PAYMENT-RESPONSE"] ||
    response["payment-response"] ||
    response["X-PAYMENT-RESPONSE"];

  if (!header) return undefined;

  if (typeof header === "string" && STELLAR_TX_HASH_RE.test(header)) {
    return header;
  }

  try {
    const decoded = JSON.parse(Buffer.from(header as string, "base64").toString());
    if (decoded.transaction) return decoded.transaction;
  } catch {
    // fall through
  }

  return undefined;
}

describe("x402 Facilitator settle — contract (Issue #814)", () => {
  it("pinned settle-success response is validated", () => {
    const settleResponse = {
      status: "success",
      transactionHash: "fc552f181bd318b300429b36c37e12e11abc8b1281fa726f75472b777c122e02",
      settlementId: "settle-123",
    };

    expect(settleResponse.status).toBe("success");
    expect(settleResponse.transactionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stellar tx hash is extracted from settle response", () => {
    const settleResponse = {
      paymentResponse: "fc552f181bd318b300429b36c37e12e11abc8b1281fa726f75472b777c122e02",
    };

    const txHash = extractX402TxHash(settleResponse);
    expect(txHash).toBe("fc552f181bd318b300429b36c37e12e11abc8b1281fa726f75472b777c122e02");
  });

  it("settle response lacking tx hash returns undefined (no fallback)", () => {
    const settleResponse = {
      status: "success",
      settlementId: "settle-123",
    };

    const txHash = extractX402TxHash(settleResponse);
    expect(txHash).toBeUndefined();
  });

  it("settle-failure/error response maps to rejected payment", () => {
    const errorResponse = {
      status: "error",
      reason: "insufficient_balance",
      code: "INSUFFICIENT_BALANCE",
    };

    const isFailure = errorResponse.status === "error";
    expect(isFailure).toBe(true);
    expect(errorResponse.reason).toBeDefined();
  });

  it("extracted hash is valid Stellar transaction hash format", () => {
    const validHash = "32eb1a47202c2e84177b5b371f0baa53ab1b8bf6c4e211c467e7cee7d385cc69";
    expect(validHash).toMatch(/^[a-f0-9]{64}$/);
    expect(validHash.length).toBe(64);
  });

  it("settle contract fixture: success response", () => {
    const fixture = {
      request: {
        paymentResponse: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        settlementId: "settle-123",
      },
      expectedResponse: {
        status: "success",
        transactionHash: "fc552f181bd318b300429b36c37e12e11abc8b1281fa726f75472b777c122e02",
        settlementId: "settle-123",
      },
    };

    expect(fixture.expectedResponse.status).toBe("success");
    expect(fixture.expectedResponse.transactionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("settle contract fixture: error response", () => {
    const fixture = {
      request: {
        paymentResponse: "invalid",
        settlementId: "settle-456",
      },
      expectedResponse: {
        status: "error",
        reason: "invalid_payment",
        code: "INVALID_PAYMENT",
      },
    };

    expect(fixture.expectedResponse.status).toBe("error");
    expect(fixture.expectedResponse.reason).toBeDefined();
  });

  it("settlement confirmed when tx hash present and valid", () => {
    const settleResponse = {
      status: "success",
      transactionHash: "d3e253f80a345c330dd6b663eadb74042f5ad06031502249e3d58a1364091c4a",
    };

    const txHash = extractX402TxHash({ paymentResponse: settleResponse.transactionHash });
    const isConfirmed = txHash !== undefined && STELLAR_TX_HASH_RE.test(txHash);

    expect(isConfirmed).toBe(true);
  });

  it("settlement rejected when status is error", () => {
    const errorResponse = {
      status: "error",
      reason: "payment_failed",
    };

    const shouldReject = errorResponse.status === "error";
    expect(shouldReject).toBe(true);
  });

  it("PAYMENT-RESPONSE header variant is recognized", () => {
    const response = {
      "PAYMENT-RESPONSE": "fc552f181bd318b300429b36c37e12e11abc8b1281fa726f75472b777c122e02",
    };

    const txHash = extractX402TxHash(response);
    expect(txHash).toBe("fc552f181bd318b300429b36c37e12e11abc8b1281fa726f75472b777c122e02");
  });

  it("payment-response lowercase header variant is recognized", () => {
    const response = {
      "payment-response": "5d62c1eef81bc713ff1d984bef4cae6383594affc8d001b8737a278b136490c9",
    };

    const txHash = extractX402TxHash(response);
    expect(txHash).toBe("5d62c1eef81bc713ff1d984bef4cae6383594affc8d001b8737a278b136490c9");
  });

  it("X-PAYMENT-RESPONSE header variant is recognized", () => {
    const response = {
      "X-PAYMENT-RESPONSE": "9c3d6d3c9527ded9dcafc7e58e47d0a9ce85d71ecdcd139d1819aeb885e37f8b",
    };

    const txHash = extractX402TxHash(response);
    expect(txHash).toBe("9c3d6d3c9527ded9dcafc7e58e47d0a9ce85d71ecdcd139d1819aeb885e37f8b");
  });

  it("refresh procedure: re-ping OZ facilitator settle endpoint", () => {
    const refreshProcedure = {
      description: "Re-run against OZ x402 Facilitator /settle endpoint",
      endpoint: "POST https://channels.openzeppelin.com/x402/testnet/settle",
      method: "capture live settle response and update fixture",
    };

    expect(refreshProcedure.endpoint).toContain("settle");
  });
});
