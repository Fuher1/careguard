import type { SpendingPolicyInput } from "./schemas";

/**
 * Maps SpendingPolicyInput keys to their `policy.*` translation key
 * (see i18n.ts / messages/en.json / messages/es.json).
 *
 * Single source of truth for policy field labels (#1144) — both the
 * displayed form label (policy-tab.tsx) and the validation error text
 * (schemas.ts) derive their wording from the same translation entries via
 * this mapping, so they can no longer drift apart.
 */
export const POLICY_FIELD_T_KEY: Record<keyof SpendingPolicyInput, string> = {
  dailyLimit: "dailyLimit",
  monthlyLimit: "monthlyLimit",
  medicationMonthlyBudget: "medicationBudget",
  billMonthlyBudget: "billBudget",
  approvalThreshold: "approvalThreshold",
  holdTimeSeconds: "holdTime",
};
