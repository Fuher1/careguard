/**
 * Fee-bump envelope doubling tests (Issue #795).
 *
 * submitTransactionWithFeeBump answers a tx_insufficient_fee by doubling the fee
 * and resubmitting the transaction inside a fee-bump envelope. These tests pin
 * the doubling sequence, the attempt cap, the MAX_FEE_STROOPS clamp, who signs
 * the envelope, and that a non-fee error is never wrapped.
 *
 * Horizon is mocked, and an injected RetryClock keeps the suite free of real sleeps.
 */

const { mockLoadAccount, mockSubmitTransaction, mockBuildFeeBump, builtTransactions, MOCK_HINT } =
  vi.hoisted(() => {
    process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
    process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTBILLPROVIDER";
    const MOCK_HINT = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
    return {
      mockLoadAccount: vi.fn(),
      mockSubmitTransaction: vi.fn(),
      mockBuildFeeBump: vi.fn(),
      // Every inner transaction the builder produces, in build order.
      builtTransactions: [] as any[],
      MOCK_HINT,
    };
  });

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue("{}"),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));
vi.mock("@stellar/stellar-sdk", () => {
  const TransactionBuilderMock: any = vi.fn().mockImplementation((_source: any, opts: any) => ({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockImplementation(() => {
      const tx = {
        kind: "inner",
        fee: opts?.fee,
        sign: vi.fn(),
        signatures: [{ hint: vi.fn().mockReturnValue(MOCK_HINT) }],
      };
      builtTransactions.push(tx);
      return tx;
    }),
  }));
  TransactionBuilderMock.buildFeeBumpTransaction = mockBuildFeeBump;

  return {
    Keypair: {
      fromSecret: vi.fn().mockReturnValue({
        publicKey: () => "GPUB123",
        sign: vi.fn(),
        signatureHint: vi.fn().mockReturnValue(MOCK_HINT),
      }),
    },
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
    TransactionBuilder: TransactionBuilderMock,
    Operation: { payment: vi.fn() },
    Asset: vi.fn(),
    Horizon: {
      Server: vi.fn().mockReturnValue({
        loadAccount: mockLoadAccount,
        submitTransaction: mockSubmitTransaction,
      }),
    },
  };
});
vi.mock("@x402/stellar", () => ({
  createEd25519Signer: vi.fn().mockReturnValue({}),
  ExactStellarScheme: vi.fn(),
}));
vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
  decodePaymentResponseHeader: vi.fn(),
}));
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockReturnValue({}) }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));

import { describe, it, expect, beforeEach } from "vitest";
import {
  submitTransactionWithFeeBump,
  FEE_BUMP_MAX_ATTEMPTS,
  type RetryClock,
} from "../tools.ts";

const MAX_FEE_STROOPS = 100_000; // matches the MAX_FEE_STROOPS default in tools.ts
const mockAccount = { id: "GPUB123", sequence: "1" };
const mockServer = { loadAccount: mockLoadAccount, submitTransaction: mockSubmitTransaction } as any;
const signer = {
  publicKey: () => "GPUB123",
  sign: () => {},
  signatureHint: () => MOCK_HINT,
} as any;

function horizonError(code: string) {
  const err: any = new Error("Request failed with status code 400");
  err.response = {
    status: 400,
    data: { extras: { result_codes: { transaction: code } } },
  };
  return err;
}

function makeFakeClock(startAt = 0) {
  let now = startAt;
  const clock: RetryClock = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
  return { clock };
}

/** Fees passed to buildFeeBumpTransaction, in call order. */
function feeBumpFees(): string[] {
  return mockBuildFeeBump.mock.calls.map((call: any[]) => call[1]);
}

beforeEach(() => {
  mockLoadAccount.mockReset();
  mockSubmitTransaction.mockReset();
  mockBuildFeeBump.mockReset();
  builtTransactions.length = 0;
  mockLoadAccount.mockResolvedValue(mockAccount);
  mockBuildFeeBump.mockImplementation(() => ({ kind: "feeBump", sign: vi.fn() }));
});

describe("submitTransactionWithFeeBump — doubling schedule (Issue #795)", () => {
  it("wraps the inner tx in a fee-bump envelope at exactly double the prior fee", async () => {
    const { clock } = makeFakeClock();
    mockSubmitTransaction
      .mockRejectedValueOnce(horizonError("tx_insufficient_fee"))
      .mockResolvedValueOnce({ hash: "hash-bumped" });

    const result = await submitTransactionWithFeeBump(
      mockServer, mockAccount, [{}], signer, "100", clock,
    );

    expect(result).toEqual({ hash: "hash-bumped", fee: "200" });
    expect(feeBumpFees()).toEqual(["200"]);
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(2);
  });

  it("doubles again when the first fee bump is still too cheap", async () => {
    const { clock } = makeFakeClock();
    mockSubmitTransaction
      .mockRejectedValueOnce(horizonError("tx_insufficient_fee"))
      .mockRejectedValueOnce(horizonError("tx_insufficient_fee"))
      .mockResolvedValueOnce({ hash: "hash-second-bump" });

    const result = await submitTransactionWithFeeBump(
      mockServer, mockAccount, [{}], signer, "100", clock,
    );

    expect(result.fee).toBe("400");
    expect(feeBumpFees()).toEqual(["200", "400"]);
  });

  it("submits exactly once per step of the doubling schedule", async () => {
    const { clock } = makeFakeClock();
    mockSubmitTransaction.mockRejectedValue(horizonError("tx_insufficient_fee"));

    await expect(
      submitTransactionWithFeeBump(mockServer, mockAccount, [{}], signer, "100", clock),
    ).rejects.toMatchObject({
      response: { data: { extras: { result_codes: { transaction: "tx_insufficient_fee" } } } },
    });

    // Base attempt + one submission per fee bump.
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(FEE_BUMP_MAX_ATTEMPTS);
    expect(feeBumpFees()).toEqual(["200", "400"]);

    const innerFees = builtTransactions.map((tx) => tx.fee);
    expect(innerFees).toEqual(["100", "200", "400"]);
  });

  it("stops at the attempt cap and surfaces the final failure instead of retrying forever", async () => {
    const { clock } = makeFakeClock();
    const finalError = horizonError("tx_insufficient_fee");
    mockSubmitTransaction.mockRejectedValue(finalError);

    await expect(
      submitTransactionWithFeeBump(mockServer, mockAccount, [{}], signer, "100", clock),
    ).rejects.toBe(finalError);

    expect(mockSubmitTransaction.mock.calls.length).toBe(FEE_BUMP_MAX_ATTEMPTS);
    expect(mockBuildFeeBump.mock.calls.length).toBe(FEE_BUMP_MAX_ATTEMPTS - 1);
  });

  it("clamps the doubled fee at MAX_FEE_STROOPS", async () => {
    const { clock } = makeFakeClock();
    mockSubmitTransaction
      .mockRejectedValueOnce(horizonError("tx_insufficient_fee"))
      .mockResolvedValueOnce({ hash: "hash-clamped" });

    // 80_000 doubled is 160_000, above the 100_000 cap.
    const result = await submitTransactionWithFeeBump(
      mockServer, mockAccount, [{}], signer, "80000", clock,
    );

    expect(result.fee).toBe(String(MAX_FEE_STROOPS));
    expect(feeBumpFees()).toEqual([String(MAX_FEE_STROOPS)]);
  });
});

describe("submitTransactionWithFeeBump — envelope signing", () => {
  it("signs the envelope with the agent keypair as fee source", async () => {
    const { clock } = makeFakeClock();
    const envelope = { kind: "feeBump", sign: vi.fn() };
    mockBuildFeeBump.mockReturnValue(envelope);
    mockSubmitTransaction
      .mockRejectedValueOnce(horizonError("tx_insufficient_fee"))
      .mockResolvedValueOnce({ hash: "hash-signed" });

    await submitTransactionWithFeeBump(mockServer, mockAccount, [{}], signer, "100", clock);

    const [feeSource, fee, inner, passphrase] = mockBuildFeeBump.mock.calls[0];
    expect(feeSource).toBe(signer);
    expect(fee).toBe("200");
    expect(inner.kind).toBe("inner");
    expect(passphrase).toBeDefined();
    expect(envelope.sign).toHaveBeenCalledWith(signer);
  });

  it("preserves the inner transaction's own signature", async () => {
    const { clock } = makeFakeClock();
    mockSubmitTransaction
      .mockRejectedValueOnce(horizonError("tx_insufficient_fee"))
      .mockResolvedValueOnce({ hash: "hash-inner-signed" });

    await submitTransactionWithFeeBump(mockServer, mockAccount, [{}], signer, "100", clock);

    const inner = mockBuildFeeBump.mock.calls[0][2];
    expect(inner.sign).toHaveBeenCalledWith(signer);
    expect(inner.signatures).toHaveLength(1);
  });

  it("submits the envelope, not the bare inner transaction", async () => {
    const { clock } = makeFakeClock();
    mockSubmitTransaction
      .mockRejectedValueOnce(horizonError("tx_insufficient_fee"))
      .mockResolvedValueOnce({ hash: "hash-envelope" });

    await submitTransactionWithFeeBump(mockServer, mockAccount, [{}], signer, "100", clock);

    expect(mockSubmitTransaction.mock.calls[0][0].kind).toBe("inner");
    expect(mockSubmitTransaction.mock.calls[1][0].kind).toBe("feeBump");
  });
});

describe("submitTransactionWithFeeBump — non-fee errors", () => {
  it("propagates tx_bad_auth immediately without wrapping it", async () => {
    const { clock } = makeFakeClock();
    const authError = horizonError("tx_bad_auth");
    mockSubmitTransaction.mockRejectedValue(authError);

    await expect(
      submitTransactionWithFeeBump(mockServer, mockAccount, [{}], signer, "100", clock),
    ).rejects.toBe(authError);

    expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
    expect(mockBuildFeeBump).not.toHaveBeenCalled();
  });

  it("propagates tx_insufficient_balance without a fee bump", async () => {
    const { clock } = makeFakeClock();
    mockSubmitTransaction.mockRejectedValue(horizonError("tx_insufficient_balance"));

    await expect(
      submitTransactionWithFeeBump(mockServer, mockAccount, [{}], signer, "100", clock),
    ).rejects.toMatchObject({ response: { status: 400 } });

    expect(mockBuildFeeBump).not.toHaveBeenCalled();
  });

  it("returns the first success without ever building an envelope", async () => {
    const { clock } = makeFakeClock();
    mockSubmitTransaction.mockResolvedValueOnce({ hash: "hash-first-try" });

    const result = await submitTransactionWithFeeBump(
      mockServer, mockAccount, [{}], signer, "100", clock,
    );

    expect(result).toEqual({ hash: "hash-first-try", fee: "100" });
    expect(mockBuildFeeBump).not.toHaveBeenCalled();
  });
});
