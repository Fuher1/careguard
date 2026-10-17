import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../../lib/types";

const autoTableCalls: Array<{ body: unknown[][] }> = [];
const save = vi.fn();

vi.mock("jspdf", () => ({
  default: vi.fn().mockImplementation(() => ({
    setProperties: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
    setDrawColor: vi.fn(),
    line: vi.fn(),
    getNumberOfPages: vi.fn(() => 1),
    setPage: vi.fn(),
    save,
  })),
}));

vi.mock("jspdf-autotable", () => ({
  default: vi.fn().mockImplementation((_doc: unknown, options: { body: unknown[][] }) => {
    autoTableCalls.push(options);
  }),
}));

import {
  downloadTransactionPDF,
  formatTxHashDisplay,
} from "../pdf";

describe("transaction hash PDF formatting", () => {
  beforeEach(() => {
    autoTableCalls.length = 0;
    vi.clearAllMocks();
  });

  it("uses the shared truncation length for valid Stellar hashes", () => {
    expect(formatTxHashDisplay("a".repeat(64))).toEqual({
      display: `${"a".repeat(16)}...`,
      decodeFailed: false,
    });
  });

  it("visually distinguishes undecodable hashes in a mixed transaction PDF", () => {
    const base: Omit<Transaction, "id" | "stellarTxHash"> = {
      timestamp: new Date().toISOString(),
      type: "medication",
      description: "Prescription",
      amount: 10,
      recipient: "Rosa",
      status: "completed",
      category: "meds",
    };
    downloadTransactionPDF(
      [
        { ...base, id: "valid", stellarTxHash: "a".repeat(64) },
        { ...base, id: "invalid", stellarTxHash: "not-a-stellar-hash" },
      ],
      null,
    );

    const body = autoTableCalls[0].body;
    expect(body[0][5]).toBe(`${"a".repeat(16)}...`);
    expect(body[1][5]).toMatchObject({
      content: expect.stringContaining("?"),
      styles: { fontStyle: "italic", textColor: [185, 28, 28] },
    });
    expect(save).toHaveBeenCalledWith("careguard-transaction-report.pdf");
  });
});
