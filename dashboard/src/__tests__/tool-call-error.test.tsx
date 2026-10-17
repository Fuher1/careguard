import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActivityTab } from "../components/tabs/activity-tab";
import type { AgentLogEntry } from "../components/types";

vi.mock("../app/pdf", () => ({ downloadTransactionPDF: vi.fn() }));
vi.mock("../components/primitives/tx-link", () => ({
  TxLink: ({ hash }: { hash?: string }) => <span>{hash ?? "-"}</span>,
}));
vi.mock("../components/primitives/confirm-dialog", () => ({
  ConfirmDialog: () => null,
}));

const baseProps = {
  recipient: { name: "Rosa Garcia", age: 78, facility: "General Hospital" },
  setAgentLog: vi.fn(),
  allTransactions: [],
  auditEvents: [],
  pagination: null,
  currentPage: 0,
  setCurrentPage: vi.fn(),
  pageSize: 25,
  setPageSize: vi.fn(),
  spending: null,
  onResetAgent: vi.fn(),
};

function makeErrorEntry(overrides: Partial<AgentLogEntry> = {}): AgentLogEntry {
  return {
    id: "err-1",
    timestamp: Date.now(),
    message: "  -> compare_pharmacy_prices ERROR",
    errorDetail: "TypeError: Cannot read properties of undefined (reading 'price')\n    at comparePrices (agent/tools.ts:123:45)",
    ...overrides,
  };
}

function makeNormalEntry(overrides: Partial<AgentLogEntry> = {}): AgentLogEntry {
  return {
    id: "ok-1",
    timestamp: Date.now(),
    message: "  -> audit_medical_bill OK",
    ...overrides,
  };
}

describe("Tool-call error expand/collapse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders normal log entries as plain text without details", () => {
    const entries = [makeNormalEntry()];
    const { container } = render(<ActivityTab {...baseProps} agentLog={entries} />);
    expect(screen.getAllByText(/audit_medical_bill OK/).length).toBeGreaterThan(0);
    expect(container.querySelector("details")).not.toBeInTheDocument();
    expect(screen.queryByText("Copy error")).not.toBeInTheDocument();
  });

  it("renders error entries inside a details element", () => {
    const entries = [makeErrorEntry()];
    const { container } = render(<ActivityTab {...baseProps} agentLog={entries} />);
    expect(screen.getAllByText(/compare_pharmacy_prices ERROR/).length).toBeGreaterThan(0);
    expect(container.querySelector("details")).toBeInTheDocument();
  });

  it("keeps details closed by default", () => {
    const entries = [makeErrorEntry()];
    const { container } = render(<ActivityTab {...baseProps} agentLog={entries} />);
    const details = container.querySelector("details")!;
    expect(details.hasAttribute("open")).toBe(false);
  });

  it("shows error detail and copy button when expanded", () => {
    const errorDetail = "TypeError: Cannot read properties of undefined (reading 'price')";
    const entries = [makeErrorEntry({ errorDetail })];
    const { container } = render(<ActivityTab {...baseProps} agentLog={entries} />);
    const details = container.querySelector("details")!;
    fireEvent.click(details.querySelector("summary")!);
    expect(details.hasAttribute("open")).toBe(true);
    expect(screen.getByText(errorDetail)).toBeInTheDocument();
    expect(screen.getByText("Copy error")).toBeInTheDocument();
  });

  it("renders error detail inside a pre block", () => {
    const errorDetail = "Detailed stack trace\nLine 2\nLine 3";
    const entries = [makeErrorEntry({ errorDetail })];
    const { container } = render(<ActivityTab {...baseProps} agentLog={entries} />);
    const details = container.querySelector("details")!;
    fireEvent.click(details.querySelector("summary")!);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre!.textContent).toBe(errorDetail);
  });

  it("copies error detail to clipboard when copy button clicked", async () => {
    vi.stubGlobal("isSecureContext", true);
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    const errorDetail = "TypeError: something failed";
    const entries = [makeErrorEntry({ errorDetail })];
    const { container } = render(<ActivityTab {...baseProps} agentLog={entries} />);
    const details = container.querySelector("details")!;
    fireEvent.click(details.querySelector("summary")!);
    fireEvent.click(screen.getByText("Copy error"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(errorDetail);
  });
});
