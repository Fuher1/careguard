"use client";

import { useState, useMemo, useCallback } from "react";
import { downloadTransactionPDF } from "../../app/pdf";
import { copyText } from "../../lib/clipboard";
import type { RecipientProfile } from "../../lib/types";
import { ConfirmDialog } from "../primitives/confirm-dialog";
import { TxLink } from "../primitives/tx-link";
import { sanitizeUserString } from "../../lib/sanitize";
import type {
  AgentLogEntry,
  PaginationData,
  SpendingData,
  Transaction,
  AuditLogEvent,
} from "../types";

export interface ActivityTabProps {
  recipient: RecipientProfile;
  agentLog: AgentLogEntry[];
  setAgentLog: (entries: AgentLogEntry[]) => void;
  allTransactions: Transaction[];
  auditEvents?: AuditLogEvent[];
  pagination: PaginationData | null;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  spending: SpendingData | null;
  onResetAgent: () => void;
  loadingTransactions?: boolean;
  loadingSpending?: boolean;
}

/** Tags keyed by transaction id. Each tx can have multiple tags. */
type TxTagsMap = Record<string, string[]>;

const PRESET_TAGS = [
  "reimbursable",
  "urgent care",
  "review",
  "disputed",
  "personal",
];

function exportCsvWithTags(
  transactions: Transaction[],
  tagsMap: TxTagsMap,
): void {
  const header = [
    "ID",
    "Timestamp",
    "Type",
    "Description",
    "Amount",
    "Status",
    "Category",
    "Stellar Tx",
    "Tags",
  ];
  const rows = transactions.map((tx) => {
    const tags = (tagsMap[tx.id] ?? []).join("|");
    return [
      tx.id,
      tx.timestamp,
      tx.type,
      `"${tx.description.replace(/"/g, '""')}"`,
      tx.amount.toFixed(2),
      tx.status,
      tx.category,
      tx.stellarTxHash ?? "",
      tags,
    ].join(",");
  });
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `careguard-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ActivityTab({
  recipient,
  agentLog,
  setAgentLog,
  allTransactions,
  auditEvents = [],
  pagination,
  currentPage,
  setCurrentPage,
  pageSize,
  setPageSize,
  spending,
  onResetAgent,
}: ActivityTabProps) {
  const [showAllLogEntries, setShowAllLogEntries] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Tags state: { [txId]: string[] }
  const [tagsMap, setTagsMap] = useState<TxTagsMap>({});
  // Per-tx tag input state
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});

  // Search / filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  // Collect all unique tags across all transactions for the filter chip bar
  const allUsedTags = useMemo(() => {
    const set = new Set<string>();
    for (const tags of Object.values(tagsMap) as string[][]) {
      for (const t of tags) set.add(t);
    }
    return Array.from(set).sort();
  }, [tagsMap]);

  const addTag = useCallback((txId: string, raw: string) => {
    const tag = sanitizeUserString(raw).toLowerCase().trim();
    if (!tag) return;
    setTagsMap((prev) => {
      const existing = prev[txId] ?? [];
      if (existing.includes(tag)) return prev;
      return { ...prev, [txId]: [...existing, tag] };
    });
    setTagInputs((prev) => ({ ...prev, [txId]: "" }));
  }, []);

  const removeTag = useCallback((txId: string, tag: string) => {
    setTagsMap((prev) => {
      const existing = prev[txId] ?? [];
      const next = existing.filter((t) => t !== tag);
      return { ...prev, [txId]: next };
    });
  }, []);

  // allTransactions arrives pre-sorted newest-first from fetchTransactions (#220).
  const mergedTimeline = useMemo(() => {
    type TimelineItem = {
      ts: number;
      kind: "tx" | "audit";
      id: string;
      data: any;
    };
    const txItems: TimelineItem[] = allTransactions.map((tx) => ({
      kind: "tx",
      ts: new Date(tx.timestamp).getTime(),
      id: tx.id,
      data: tx,
    }));
    const auditItems: TimelineItem[] = auditEvents.map((au) => ({
      kind: "audit",
      ts: new Date(au.timestamp).getTime(),
      id: `audit-${au.timestamp}-${au.event}`,
      data: au,
    }));
    auditItems.sort((a, b) => b.ts - a.ts);
    const merged: TimelineItem[] = [];
    let ti = 0,
      ai = 0;
    while (ti < txItems.length && ai < auditItems.length) {
      if (txItems[ti].ts >= auditItems[ai].ts) merged.push(txItems[ti++]);
      else merged.push(auditItems[ai++]);
    }
    while (ti < txItems.length) merged.push(txItems[ti++]);
    while (ai < auditItems.length) merged.push(auditItems[ai++]);
    return merged;
  }, [allTransactions, auditEvents]);

  // Apply search + tag filter
  const filteredTimeline = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return mergedTimeline.filter((item) => {
      if (item.kind === "audit") {
        // Audit rows are not tagged/searched — keep them only when no filters are active
        return !q && !activeTagFilter;
      }
      const tx = item.data as Transaction;
      const txTags = tagsMap[tx.id] ?? [];

      if (activeTagFilter && !txTags.includes(activeTagFilter)) return false;

      if (q) {
        const descMatch = tx.description.toLowerCase().includes(q);
        const amtMatch = tx.amount.toFixed(2).includes(q);
        const tagMatch = txTags.some((t) => t.includes(q));
        if (!descMatch && !amtMatch && !tagMatch) return false;
      }

      return true;
    });
  }, [mergedTimeline, searchQuery, activeTagFilter, tagsMap]);

  return (
    <div
      role="tabpanel"
      id="tabpanel-activity"
      aria-labelledby="tab-activity"
      tabIndex={0}
      className="space-y-4"
    >
      <ConfirmDialog
        open={confirmOpen}
        title="Reset all agent data?"
        description={`This will delete ${allTransactions.length} transaction${
          allTransactions.length === 1 ? "" : "s"
        }, the agent log, and all audit results. This cannot be undone.`}
        confirmLabel="Delete everything"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onResetAgent();
        }}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-700">
          Transaction Log
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          {allTransactions.length > 0 && (
            <>
              <button
                onClick={() =>
                  downloadTransactionPDF(allTransactions, spending, {
                    recipient,
                  })
                }
                className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all"
              >
                Download PDF
              </button>
              <button
                onClick={() => exportCsvWithTags(allTransactions, tagsMap)}
                className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100 active:bg-emerald-200 cursor-pointer transition-all"
              >
                Export CSV
              </button>
            </>
          )}
          <button
            onClick={() => setAgentLog([])}
            className="text-xs text-amber-500 hover:text-amber-700 hover:underline active:text-amber-800 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 rounded px-1"
          >
            Clear Log
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            className="text-xs text-red-500 hover:text-red-700 hover:underline active:text-red-800 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500 rounded px-1"
          >
            Reset All
          </button>
        </div>
      </div>

      {/* Agent log terminal */}
      <div
        className="bg-slate-900 rounded-xl p-4 font-mono text-xs text-green-400 max-h-48 overflow-y-auto"
        aria-live="polite"
      >
        <div aria-hidden="true">
          {agentLog.length === 0 ? (
            <span className="text-slate-500">No agent activity yet...</span>
          ) : (
            <>
              {!showAllLogEntries && agentLog.length > 50 && (
                <div className="text-slate-400 mb-2">
                  Showing last 50 of {agentLog.length} entries.{" "}
                  <button
                    onClick={() => setShowAllLogEntries(true)}
                    className="text-sky-400 hover:text-sky-300 underline"
                  >
                    Show all
                  </button>
                </div>
              )}
              {(showAllLogEntries ? agentLog : agentLog.slice(-50)).map(
                (entry) => (
                  <div key={entry.id}>
                    {entry.errorDetail ? (
                      <details className="group">
                        <summary className="cursor-pointer list-none flex items-center gap-1 hover:text-green-300">
                          <span className="text-xs opacity-60 group-open:opacity-100">
                            ▸
                          </span>
                          {entry.message}
                        </summary>
                        <div className="ml-4 mt-1 space-y-1">
                          <pre className="text-xs text-red-400 whitespace-pre-wrap break-all bg-slate-800 p-2 rounded">
                            {entry.errorDetail}
                          </pre>
                          <button
                            onClick={async () => {
                              if (!entry.errorDetail) return;
                              const result = await copyText(entry.errorDetail);
                              if (result === "ok" || result === "fallback") {
                                const btn =
                                  document.activeElement as HTMLElement;
                                const orig = btn?.textContent;
                                if (btn) {
                                  btn.textContent = "Copied!";
                                  setTimeout(() => {
                                    btn.textContent = orig;
                                  }, 1500);
                                }
                              }
                            }}
                            className="text-[10px] text-sky-400 hover:text-sky-300 underline"
                          >
                            Copy error
                          </button>
                        </div>
                      </details>
                    ) : (
                      entry.message
                    )}
                  </div>
                ),
              )}
              {showAllLogEntries && agentLog.length > 50 && (
                <div className="text-slate-400 mt-2">
                  <button
                    onClick={() => setShowAllLogEntries(false)}
                    className="text-sky-400 hover:text-sky-300 underline"
                  >
                    Show last 50
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="sr-only">
          {agentLog
            .slice(-20)
            .map((entry) => entry.message)
            .join("\n")}
        </div>
      </div>

      {/* Search & tag filters */}
      <div className="space-y-2">
        <div className="relative">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by description, tag, or amount…"
            aria-label="Search transactions"
            className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          />
          <svg
            className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
            />
          </svg>
        </div>

        {/* Tag filter chips */}
        {allUsedTags.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5 items-center"
            aria-label="Filter by tag"
          >
            <span className="text-xs text-slate-400">Filter:</span>
            {allUsedTags.map((tag) => (
              <button
                key={tag}
                onClick={() =>
                  setActiveTagFilter((prev) => (prev === tag ? null : tag))
                }
                className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                  activeTagFilter === tag
                    ? "bg-sky-500 text-white border-sky-500"
                    : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100"
                }`}
              >
                {tag}
              </button>
            ))}
            {activeTagFilter && (
              <button
                onClick={() => setActiveTagFilter(null)}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {(searchQuery || activeTagFilter) && (
          <p className="text-xs text-slate-500">
            Showing {filteredTimeline.filter((i) => i.kind === "tx").length} of{" "}
            {allTransactions.length} transactions
          </p>
        )}
      </div>

      {/* Transactions table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {filteredTimeline.length === 0 && !pagination ? (
          <div className="p-8 text-center text-sm text-slate-400">
            {searchQuery || activeTagFilter
              ? "No transactions match your search."
              : "No activity yet"}
          </div>
        ) : (
          <>
            {pagination && (
              <div className="border-b border-slate-200 px-4 py-3 bg-slate-50">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    Showing{" "}
                    {Math.min(
                      pagination.limit,
                      pagination.total - pagination.offset,
                    )}{" "}
                    of {pagination.total} transactions
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(0);
                      }}
                      className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                    >
                      <option value={10}>10/page</option>
                      <option value={25}>25/page</option>
                      <option value={50}>50/page</option>
                      <option value={100}>100/page</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          setCurrentPage(Math.max(0, currentPage - 1))
                        }
                        disabled={!pagination.hasPrevious}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                      >
                        Previous
                      </button>
                      <span className="px-2 py-1 text-xs text-slate-600">
                        Page {currentPage + 1} of{" "}
                        {Math.ceil(pagination.total / pagination.limit)}
                      </span>
                      <button
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={!pagination.hasMore}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="overflow-x-auto shadow-[inset_-10px_0_12px_-12px_rgba(15,23,42,0.25)]">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="hidden md:table-cell text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Time
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Type
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Description
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">
                      Amount
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">
                      Status
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">
                      Stellar Tx
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Tags
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTimeline.map((item) => {
                    if (item.kind === "audit") {
                      const au = item.data as AuditLogEvent;
                      return (
                        <tr
                          key={item.id}
                          className="border-b border-slate-100 last:border-0 bg-slate-50/50"
                        >
                          <td className="hidden md:table-cell px-4 py-2 text-xs text-slate-400">
                            {new Date(au.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="px-4 py-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-200">
                              audit
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs">
                            <span className="font-semibold text-slate-700">
                              {au.event}
                            </span>
                            {au.details?.tool && (
                              <span className="text-slate-500 ml-1">
                                — Tool: {String(au.details.tool)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right text-xs font-mono text-slate-400">
                            -
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-slate-500">
                            {au.actor}
                          </td>
                          <td className="px-4 py-2 text-right text-xs text-slate-400">
                            -
                          </td>
                          <td className="px-4 py-2" />
                        </tr>
                      );
                    }

                    const tx = item.data as Transaction;
                    const txTags = tagsMap[tx.id] ?? [];
                    const inputVal = tagInputs[tx.id] ?? "";

                    return (
                      <tr
                        key={tx.id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="hidden md:table-cell px-4 py-2 text-xs text-slate-400">
                          {new Date(tx.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              tx.type === "medication"
                                ? "bg-blue-100 text-blue-700"
                                : tx.type === "bill"
                                  ? "bg-purple-100 text-purple-700"
                                  : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs">{tx.description}</td>
                        <td className="px-4 py-2 text-right text-xs font-mono">
                          $
                          {tx.amount < 0.01
                            ? tx.amount.toFixed(4)
                            : tx.amount.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              tx.status === "completed"
                                ? "bg-green-100 text-green-700"
                                : tx.status === "blocked"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {tx.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <TxLink
                            hash={tx.stellarTxHash}
                            txHashStatus={tx.txHashStatus}
                          />
                        </td>
                        {/* Tags cell */}
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1 items-center min-w-[160px]">
                            {txTags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-sky-100 text-sky-700"
                              >
                                {tag}
                                <button
                                  onClick={() => removeTag(tx.id, tag)}
                                  aria-label={`Remove tag ${tag}`}
                                  className="hover:text-sky-900 cursor-pointer leading-none"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            {/* Tag input */}
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                addTag(tx.id, inputVal);
                              }}
                              className="flex items-center gap-1"
                            >
                              <input
                                type="text"
                                maxLength={40}
                                value={inputVal}
                                onChange={(e) =>
                                  setTagInputs((prev) => ({
                                    ...prev,
                                    [tx.id]: e.target.value,
                                  }))
                                }
                                placeholder="+ tag"
                                aria-label={`Add tag to ${tx.description}`}
                                list={`presets-${tx.id}`}
                                className="w-20 text-[10px] px-1.5 py-0.5 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-sky-400 bg-white"
                              />
                              <datalist id={`presets-${tx.id}`}>
                                {PRESET_TAGS.map((p) => (
                                  <option key={p} value={p} />
                                ))}
                              </datalist>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
