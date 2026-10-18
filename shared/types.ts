// CareGuard Shared Types

/**
 * Drug Interaction Severity Convention
 *
 * The following severity levels are used for drug interactions,
 * ordered by clinical risk:
 * - "severe" (0): Life-threatening or requires immediate intervention
 * - "moderate" (1): Significant interaction requiring monitoring/adjustment
 * - "mild" (2): Minor interaction with minimal clinical impact
 *
 * When sorting interactions, severe > moderate > mild.
 * For interactions with equal severity, sort alphabetically by drug names.
 */

import { z } from "zod";

// ── Dosage History (Issue #1227) ─────────────────────────────────────────────

export const DosageHistoryEntrySchema = z.object({
  id: z.string().min(1),
  previousDosage: z.string().min(1),
  previousFrequency: z.string().min(1),
  newDosage: z.string().min(1),
  newFrequency: z.string().min(1),
  changedAt: z.string().min(1),
  reason: z.string().optional(),
  prescriber: z.string().optional(),
});

export type DosageHistoryEntry = z.infer<typeof DosageHistoryEntrySchema>;

// ── Medication ────────────────────────────────────────────────────────────────

export const MedicationSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().min(1),
  frequency: z.string().min(1),
  currentPharmacy: z.string().optional(),
  currentPrice: z.number().nonnegative().optional(),
  nextRefillDate: z.string().optional(),
  dosageHistory: z.array(DosageHistoryEntrySchema).optional().default([]),
});

export type Medication = z.infer<typeof MedicationSchema>;

// ── PharmacyPrice ─────────────────────────────────────────────────────────────

export type SeverityThreshold = 'any' | 'major' | 'moderate' | 'mild';

export interface SideEffectEntry {
  id: string;
  recipientId: string;
  medicationId: string;
  description: string;
  severity: 'mild' | 'moderate' | 'severe';
  timestamp: string;
}

export interface SpendingPolicy {
  dailyLimit: number;
  monthlyLimit: number;
  medicationMonthlyBudget: number;
  billMonthlyBudget: number;
  approvalThreshold: number; // require caregiver approval above this amount
  holdTimeSeconds: number; // time before pending approvals auto-approve
  severityThreshold?: SeverityThreshold;
  /**
   * IANA timezone string for the caregiver's local day (Issue #207).
   * Example: "America/Phoenix", "America/New_York", "Europe/London".
   * When set, daily-limit checks use this timezone to determine "today"
   * rather than UTC or the global SPENDING_TIMEZONE env var.
   * Defaults to the SPENDING_TIMEZONE env var if omitted.
   */
  timezone?: string;
  toolFees?: Record<string, number>; // per-tool query fees (e.g., comparePharmacyPrices: 0.002)
  notifications?: {
    email: boolean;
    sms: boolean;
    emailAddress?: string;
    phoneNumber?: string;
  };
}

// A confirmed Stellar transaction hash is always 64 lowercase/uppercase hex chars.
export const STELLAR_TX_HASH_RE = /^[0-9a-f]{64}$/i;

export const TRANSACTION_CATEGORY = {
  MEDICATIONS: "medications",
  BILLS: "bills",
  SERVICE_FEES: "service_fees",
} as const;

export const TRANSACTION_CATEGORIES = [
  TRANSACTION_CATEGORY.MEDICATIONS,
  TRANSACTION_CATEGORY.BILLS,
  TRANSACTION_CATEGORY.SERVICE_FEES,
] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

export function isTransactionCategory(
  category: unknown,
): category is TransactionCategory {
  return (
    typeof category === "string" &&
    (TRANSACTION_CATEGORIES as readonly string[]).includes(category)
  );
}

export function normalizeTransactionCategory(
  category: unknown,
): TransactionCategory {
  return isTransactionCategory(category)
    ? category
    : TRANSACTION_CATEGORY.SERVICE_FEES;
}

// ── Transaction ───────────────────────────────────────────────────────────────

export const TransactionSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.enum(["medication", "bill", "service_fee"]),
  description: z.string(),
  amount: z.number().nonnegative(),
  recipient: z.string(),
  // Always a real 64-char hex Stellar tx hash, or undefined. Never a raw/base64
  // payment receipt — the backend normalizes that before recording the transaction (#14).
  stellarTxHash: z.string().regex(STELLAR_TX_HASH_RE).optional(),
  // 'extracted': hash was successfully parsed from the x402 PAYMENT-RESPONSE header.
  // 'extraction_failed': header was present but all parse strategies failed (#191).
  txHashStatus: z.enum(["extracted", "extraction_failed"]).optional(),
  mppOrderId: z.string().optional(),
  status: z.enum([
    "pending",
    "approved",
    "completed",
    "blocked",
    "disputed",
    "cancelled",
    "rejected",
  ]),
  category: z.enum(TRANSACTION_CATEGORIES),
  pendingUntil: z.string().optional(),
  submittedAt: z.string().optional(),
  // Optional caregiver-authored memo for personal record-keeping, distinct
  // from the auto-generated description. Validated to the Stellar MEMO_TEXT
  // limit (28 bytes) so it can safely be used as an on-chain memo if needed.
  memo: z.string().max(28).optional(),
  // Medication order fulfilment lifecycle (Feature: order tracking).
  // Only present on medication-type transactions.
  order_status: z.enum(["submitted", "ready", "picked_up"]).optional(),
  order_status_history: z
    .array(
      z.object({
        status: z.enum(["submitted", "ready", "picked_up"]),
        timestamp: z.string(),
        updatedBy: z.string(),
      }),
    )
    .optional(),
});

export type Transaction = z.infer<typeof TransactionSchema>;

// ── Medication order status ───────────────────────────────────────────────────
export const ORDER_STATUS = {
  SUBMITTED: "submitted",
  READY: "ready",
  PICKED_UP: "picked_up",
} as const;

export const ORDER_STATUSES = [
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.READY,
  ORDER_STATUS.PICKED_UP,
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Stellar MEMO_TEXT max length in bytes — used for memo validation.
export const STELLAR_MEMO_TEXT_MAX_BYTES = 28;

// Audit-log event names that are caregiver-relevant (vs internal-only technical).
export const CAREGIVER_AUDIT_EVENTS = [
  "policy.updated",
  "spending.reset",
  "agent.policy_updated",
  "agent.reset",
  "agent.paused",
  "agent.resumed",
  "agent.auto-paused",
] as const;

// ── AgentAction ───────────────────────────────────────────────────────────────

export const AgentActionSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  action: z.string(),
  details: z.string(),
  cost: z.number().nonnegative(),
  result: z.string(),
  transactions: z.array(TransactionSchema),
});

export type AgentAction = z.infer<typeof AgentActionSchema>;

// ── CareRecipientProfile (Issue #1067) ────────────────────────────────────────

export interface CareRecipientProfile {
  name: string;
  walletAddress: string;
  medications: Medication[];
  spendingPolicy: SpendingPolicy;
  monthlySpending: {
    medications: number;
    bills: number;
    serviceFees: number;
    total: number;
  };
  savingsAchieved: number;
}

/** Legacy type alias for CareRecipientProfile (Issue #1067) */
export type CareRecipient = CareRecipientProfile;

// ── Alert ─────────────────────────────────────────────────────────────────────

export const AlertSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.enum([
    "approval_needed",
    "error_found",
    "refill_due",
    "budget_warning",
    "policy_blocked",
  ]),
  title: z.string(),
  description: z.string(),
  amount: z.number().nonnegative().optional(),
  actionRequired: z.boolean(),
  resolved: z.boolean(),
});

export type Alert = z.infer<typeof AlertSchema>;

// ── Multi-Signature Custody (Issue #1226) ────────────────────────────────────

export const MultisigConfigSchema = z.object({
  recipientId: z.string().optional(),
  enabled: z.boolean().default(false),
  coSignerPublicKey: z.string().optional(),
  coSigners: z.array(z.string()).default([]),
  thresholdAmount: z.number().positive().default(50),
  windowMinutes: z.number().int().positive().default(1440),
  timeWindowHours: z.number().positive().default(24),
});

export type MultisigConfig = z.infer<typeof MultisigConfigSchema>;

export const MultisigRequestSchema = z.object({
  id: z.string().min(1),
  recipientId: z.string().min(1),
  type: z.enum(["medication", "bill"]),
  description: z.string(),
  amount: z.number().positive(),
  recipientAddress: z.string().optional(),
  destinationWallet: z.string().optional(),
  asset: z.string().default("USDC"),
  envelopeXdr: z.string(),
  requiredSigner: z.string().optional(),
  requiredSignatures: z.number().default(2),
  collectedSignatures: z.array(z.string()).default([]),
  status: z.enum([
    "pending",
    "pending_signature",
    "submitted",
    "completed",
    "rejected",
    "expired",
  ]),
  createdAt: z.string(),
  expiresAt: z.string(),
  stellarTxHash: z.string().optional(),
  txHash: z.string().optional(),
  error: z.string().optional(),
  rejectionReason: z.string().optional(),
});

export type MultisigPendingRequest = z.infer<typeof MultisigRequestSchema>;

// ── Recipient Data Export (Issue #1225) ───────────────────────────────────────

export const RecipientExportBundleSchema = z.object({
  exportMetadata: z.object({
    exportedAt: z.string(),
    version: z.string(),
    recipientId: z.string(),
    format: z.string(),
  }),
  recipient: z.object({
    id: z.string(),
    name: z.string(),
    age: z.number().nullable(),
    primaryDoctor: z.string().nullable(),
    insurance: z.string().nullable(),
  }),
  medications: z.array(MedicationSchema),
  policy: SpendingPolicySchema,
  transactions: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string(),
      type: z.string(),
      description: z.string(),
      amount: z.number(),
      recipient: z.string(),
      stellarTxHash: z.string().optional(),
      status: z.string(),
      category: z.string(),
    }),
  ),
  orders: z.array(
    z.object({
      orderId: z.string().optional(),
      drug: z.string(),
      pharmacy: z.string(),
      amount: z.number(),
      status: z.string().optional(),
      createdAt: z.string().optional(),
      stellarTxHash: z.string().optional(),
    }),
  ),
  allergies: z.array(RecipientAllergySchema),
  adherence: z.array(
    z.object({
      drug: z.string(),
      dosage: z.string().optional(),
      pharmacy: z.string(),
      dueDate: z.string(),
      status: z.string(),
      confirmedAt: z.string().optional(),
    }),
  ),
  notes: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().optional(),
      content: z.string(),
      createdAt: z.string(),
    }),
  ).optional().default([]),
});

export type RecipientExportBundle = z.infer<typeof RecipientExportBundleSchema>;

