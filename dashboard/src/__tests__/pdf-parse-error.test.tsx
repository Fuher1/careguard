import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { toastError, downloadBillAuditPDF, downloadMedicationPDF } = vi.hoisted(
  () => ({
    toastError: vi.fn(),
    downloadBillAuditPDF: vi.fn(),
    downloadMedicationPDF: vi.fn(),
  }),
);

vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("../app/pdf", () => ({ downloadBillAuditPDF, downloadMedicationPDF }));

import { BillsTab } from "../components/tabs/bills-tab";
import { MedicationsTab } from "../components/tabs/medications-tab";

const recipient = { name: "Rosa Garcia", age: 78, facility: "General Hospital" };

function makeValidAuditResult() {
  return {
    totalCharged: 1000,
    totalCorrect: 950,
    totalOvercharge: 50,
    errorCount: 1,
    recommendation: "Review charges.",
    lineItems: [
      {
        description: "Test",
        cptCode: "99213",
        quantity: 1,
        chargedAmount: 100,
        status: "valid" as const,
        suggestedAmount: 95,
      },
    ],
  };
}

function makeMalformedResult() {
  return { garbage: true, notAValidBillAudit: "yes" };
}

describe("BillsTab PDF download error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows toast when schema parse fails on malformed tool result", () => {
    const agentResult = {
      response: "",
      toolCalls: [{ tool: "audit_medical_bill", input: {}, result: makeMalformedResult() }],
      spending: { medications: 0, bills: 0, serviceFees: 0, total: 0 },
    };
    render(<BillsTab agentResult={agentResult} recipient={recipient} />);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't parse bill audit result"),
    );
  });

  it("calls downloadBillAuditPDF when parse succeeds", () => {
    const agentResult = {
      response: "",
      toolCalls: [{ tool: "audit_medical_bill", input: {}, result: makeValidAuditResult() }],
      spending: { medications: 0, bills: 0, serviceFees: 0, total: 0 },
    };
    render(<BillsTab agentResult={agentResult} recipient={recipient} />);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));
    expect(downloadBillAuditPDF).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does not throw when schema parse fails", () => {
    const agentResult = {
      response: "",
      toolCalls: [{ tool: "audit_medical_bill", input: {}, result: makeMalformedResult() }],
      spending: { medications: 0, bills: 0, serviceFees: 0, total: 0 },
    };
    render(<BillsTab agentResult={agentResult} recipient={recipient} />);
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: /Download PDF/i })),
    ).not.toThrow();
  });
});

describe("MedicationsTab PDF download error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows toast when schema parse fails on malformed price result", () => {
    const agentResult = {
      response: "",
      toolCalls: [
        { tool: "compare_pharmacy_prices", input: {}, result: makeMalformedResult() },
      ],
      spending: { medications: 0, bills: 0, serviceFees: 0, total: 0 },
    };
    render(<MedicationsTab agentResult={agentResult} recipient={recipient} />);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't parse medication result"),
    );
  });

  it("does not throw when schema parse fails", () => {
    const agentResult = {
      response: "",
      toolCalls: [
        { tool: "compare_pharmacy_prices", input: {}, result: makeMalformedResult() },
      ],
      spending: { medications: 0, bills: 0, serviceFees: 0, total: 0 },
    };
    render(<MedicationsTab agentResult={agentResult} recipient={recipient} />);
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: /Download PDF/i })),
    ).not.toThrow();
  });
});