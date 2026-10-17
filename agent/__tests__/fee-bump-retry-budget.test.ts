/**
 * Fee-bump 35s retry-budget boundary tests (Issue #797).
 *
 * submitTransactionWithFeeBump wraps submitTransactionWithRetry, and each of
 * up to 3 fee-bump attempts can itself retry — without an overall budget,
 * the combined path could resubmit far past any caller's patience. These
 * tests use an injected RetryClock (no real setTimeout/sleep) so simulated
 * time advances deterministically and the suite runs fast.
 */

const { mockLoadAccount, mockSubmitTransaction, MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTBILLPROVIDER";
  const MOCK_HINT = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
  return {
    mockLoadAccount: vi.fn(),
    mockSubmitTransaction: vi.fn(),
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
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({
      publicKey: () => "GPUB123",
      sign: vi.fn(),
      signatureHint: vi.fn().mockReturnValue(MOCK_HINT),
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: Object.assign(
    vi.fn().mockReturnValue({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({
        sign: vi.fn(),
        signatures: [{ hint: vi.fn().mockReturnValue(MOCK_HINT) }],
      }),
    }),
    { buildFeeBumpTransaction: vi.fn().mockReturnValue({ sign: vi.fn() }) },
  ),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: {
    Server: vi.fn().mockReturnValue({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    }),
  },
}));
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
  RetryBudgetExceededError,
  type RetryClock,
} from "../tools.ts";

const BUDGET_MS = 35_000;
const mockAccount = { id: "GPUB123", sequence: "1" };
const mockServer = { loadAccount: mockLoadAccount, submitTransaction: mockSubmitTransaction } as any;

function makeFeeError() {
  const err: any = new Error("tx_insufficient_fee");
  err.response = { data: { extras: { result_codes: { transaction: "tx_insufficient_fee" } } } };
  return err;
}

/** A fake clock whose sleep() advances simulated time instead of really waiting. */
function makeFakeClock(startAt = 0) {
  let now = startAt;
  const clock: RetryClock = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
  return { clock, advance: (ms: number) => { now += ms; }, current: () => now };
}

beforeEach(() => {
  mockLoadAccount.mockReset();
  mockSubmitTransaction.mockReset();
  mockLoadAccount.mockResolvedValue(mockAccount);
});

describe("submitTransactionWithFeeBump — 35s retry budget (Issue #797)", () => {
  it("stops at the budget boundary with a distinct timeout outcome when submissions keep failing", async () => {
    const { clock, current } = makeFakeClock();

    // Each simulated Horizon submit "costs" 20s of wall-clock time before failing —
    // enough that a second full attempt cannot fit inside the 35s budget.
    mockSubmitTransaction.mockImplementation(async () => {
      (clock as any).sleep ? await clock.sleep(20_000) : undefined;
      throw makeFeeError();
    });

    await expect(
      submitTransactionWithFeeBump(
        mockServer,
        mockAccount,
        [{}],
        { publicKey: () => "GPUB123", sign: () => {}, signatureHint: () => MOCK_HINT } as any,
        "100",
        clock,
      ),
    ).rejects.toThrow(RetryBudgetExceededError);

    // No attempt should have been allowed to push total elapsed time past the
    // budget by more than a single in-flight attempt's worth (~20s here).
    expect(current()).toBeLessThanOrEqual(BUDGET_MS + 20_000);
  });

  it("makes only one submit attempt when that single attempt alone exhausts the budget", async () => {
    const { clock } = makeFakeClock();

    // The very first attempt is always allowed to start (the deadline is computed
    // fresh at call time, so time hasn't elapsed yet) — but if it alone consumes
    // the whole budget, no second attempt should follow.
    mockSubmitTransaction.mockImplementation(async () => {
      await clock.sleep(BUDGET_MS + 5_000);
      throw makeFeeError();
    });

    await expect(
      submitTransactionWithFeeBump(
        mockServer,
        mockAccount,
        [{}],
        { publicKey: () => "GPUB123", sign: () => {}, signatureHint: () => MOCK_HINT } as any,
        "100",
        clock,
      ),
    ).rejects.toThrow(RetryBudgetExceededError);

    expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not attempt fee-bump doubling once the deadline has passed mid-flight", async () => {
    const { clock } = makeFakeClock();
    let calls = 0;

    mockSubmitTransaction.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        // First attempt fails fast (no time cost) with an insufficient-fee error...
        throw makeFeeError();
      }
      // ...but by the time we'd double the fee and retry, the budget is gone.
      (clock as any).sleep && (await (clock as any).sleep(BUDGET_MS + 1));
      throw makeFeeError();
    });

    await expect(
      submitTransactionWithFeeBump(
        mockServer,
        mockAccount,
        [{}],
        { publicKey: () => "GPUB123", sign: () => {}, signatureHint: () => MOCK_HINT } as any,
        "100",
        clock,
      ),
    ).rejects.toThrow(RetryBudgetExceededError);

    // At most 2 fee-bump attempts should have reached submitTransaction: the
    // initial one, and the one that pushed past budget — never a 3rd doubling.
    expect(mockSubmitTransaction.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("succeeds normally within budget when a retry succeeds before the deadline", async () => {
    const { clock } = makeFakeClock();

    mockSubmitTransaction
      .mockRejectedValueOnce(makeFeeError())
      .mockResolvedValueOnce({ hash: "final-hash" });

    const result = await submitTransactionWithFeeBump(
      mockServer,
      mockAccount,
      [{}],
      { publicKey: () => "GPUB123", sign: () => {}, signatureHint: () => MOCK_HINT } as any,
      "100",
      clock,
    );

    expect(result.hash).toBe("final-hash");
  });

  it("runs deterministically fast — no real wall-clock sleep, even simulating a full budget exhaustion", async () => {
    const { clock } = makeFakeClock();
    mockSubmitTransaction.mockImplementation(async () => {
      await clock.sleep(20_000);
      throw makeFeeError();
    });

    const wallClockStart = Date.now();
    await submitTransactionWithFeeBump(
      mockServer,
      mockAccount,
      [{}],
      { publicKey: () => "GPUB123", sign: () => {}, signatureHint: () => MOCK_HINT } as any,
      "100",
      clock,
    ).catch(() => {});
    const wallClockElapsed = Date.now() - wallClockStart;

    // The test simulates ~35s+ of "elapsed" budget time but must complete in
    // real time near-instantly since the fake clock never really sleeps.
    expect(wallClockElapsed).toBeLessThan(500);
  });
});
