# RFC 1446: Consolidate `sanitize.ts`, `redact.ts`, `prompt-scrub.ts` into one PII module

**Status:** Proposed
**Date:** 2026-08-27
**Issue:** [#1446](https://github.com/harystyleseze/careguard/issues/1446)

---

## Context

Three similarly-named modules each implement their own slice of removing sensitive data
from strings/objects, with **no shared vocabulary** for what counts as PII or how it is
masked:

- `shared/sanitize.ts` (26 lines) — `sanitizeUserString`
- `shared/redact.ts` (125 lines) — `redact`, `redactString`, `redactPII`, `hashTask`,
  `registerKnownNames`
- `shared/prompt-scrub.ts` (50 lines) — `buildScrubSession`, `scrubText`

A new call site can easily pick the wrong one, or miss a field pattern that another module
already catches. This RFC proposes merging them into a single `shared/pii.ts` with
purpose-specific exports (`redactForLogs`, `scrubForPrompt`, `sanitizeForResponse`) built
on one shared pattern registry.

## Trade-off

A larger single file versus three small ones — but one source of truth for which patterns
are treated as sensitive, and one place to add a new PII pattern.

## Acceptance criteria

### 1. Diff the three modules' regex/field-matching patterns

| Concern | `sanitize.ts` | `redact.ts` | `prompt-scrub.ts` |
|---|---|---|---|
| Control chars | `[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]` | — | — |
| Disallowed chars | `[^a-zA-Z0-9 \-()]` (allow-list) | — | — |
| Length cap | 80 chars | — | — |
| Stellar secret | — | `\bS[A-Z2-7]{55}\b` | — |
| Bearer/JWT | — | `\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b` | — |
| Secret field names | — | `SECRET_FIELD_NAMES` set (24 names) | — |
| Patient names | — | `registerKnownNames` → `[PATIENT NAME]` | `buildScrubSession` → `Patient A` |
| Drug specifics | — | `[A-Z][a-z]+ \d+mg` → `[MEDICATION]` | — |
| Caregiver names | — | (covered by known-names) | `Caregiver A` pseudonym |

**Key divergence:** `redact.ts` *masks* names to the literal `[PATIENT NAME]`, while
`prompt-scrub.ts` *pseudonymizes* to `Patient A`/`Caregiver B` (reversible server-side via
the session map). These serve different goals (log hygiene vs. LLM PHI minimization) and
must **not** be merged into one behavior.

**Important nuance:** `sanitize.ts` is *not* a PII tool — it is input hardening (strips
control chars / RTL marks / enforces a char allow-list and length cap) to prevent UI
parsing breakage in receipts/PDFs. It must stay as `sanitizeForResponse` and keep its
exact behavior; it shares only the "make strings safe" theme.

### 2. Consolidated module's export surface + internal pattern registry

`shared/pii.ts`:

```ts
// ── shared pattern registry (single source of truth) ──
const STELLAR_SECRET_RE = /\bS[A-Z2-7]{55}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b/gi;
const DRUG_SPECIFIC_RE = /\b[A-Z][a-z]+ \d+\s*mg\b/gi;
const SECRET_FIELD_NAMES = new Set([ /* …24 names… */ ]);

// log redaction (conservative: when in doubt, redact)
export function redactForLogs<T>(value: T, depth = 0): T;          // was redact
export function redactForLogsString(value: string): string;        // was redactString
export function redactPIIString(value: string): string;            // was redactPII
export function registerKnownNames(names: string[]): void;         // unchanged
export function hashTask(task: string): string;                    // unchanged

// prompt PHI scrubbing (pseudonymize, not mask)
export function buildScrubSession(patients: string[], caregivers: string[]): ScrubSession;
export function scrubForPrompt(text: string, session: ScrubSession): string; // was scrubText

// input hardening (NOT PII — keeps exact current behavior)
export function sanitizeForResponse(input: unknown): string;       // was sanitizeUserString
```

### 3. Migration plan updating all call sites

Add a backward-compat shim (`shared/redact.ts`, `shared/sanitize.ts`,
`shared/prompt-scrub.ts`) that re-exports from `pii.ts`, OR update call sites directly.
Direct updates:

| File | Current | New |
|---|---|---|
| `agent/runner.ts:12,14` | `buildScrubSession, scrubText`, `redactPII` | `scrubForPrompt`+`buildScrubSession`, `redactPIIString` |
| `agent/server.ts:30` | `redactPII, hashTask, registerKnownNames` | `redactPIIString, hashTask, registerKnownNames` |
| `shared/sentry.ts:19` | `redact` | `redactForLogs` |
| `services/care-recipients/routes.ts:3` | `registerKnownNames` | unchanged name |
| `services/bill-audit-api/server.ts:31` | `sanitizeUserString` | `sanitizeForResponse` |
| `services/pharmacy-payment/server.ts:25` | `sanitizeUserString` | `sanitizeForResponse` |
| `server.ts:38-39` | `sanitizeUserString`, `registerKnownNames` | `sanitizeForResponse`, unchanged |

Because `registerKnownNames` and `hashTask` keep their names, only `redact`→`redactForLogs`,
`redactString`→`redactForLogsString`, `redactPII`→`redactPIIString`, `scrubText`→
`scrubForPrompt`, `sanitizeUserString`→`sanitizeForResponse` change at call sites.

### 4. Test suite asserting each purpose-specific function still meets needs

Re-point the existing suites (no behavior change, so they pass as-is once re-exported):
- `shared/__tests__/redact.test.ts` → assert `redactForLogs`/`redactPIIString` mask names,
  secrets, bearer tokens, and field names.
- `shared/__tests__/sanitize.test.ts` → assert `sanitizeForResponse` strips control chars,
  enforces allow-list and 80-char cap.
- `shared/__tests__/prompt-scrub.test.ts` → assert `scrubForPrompt` pseudonymizes via the
  session map and that `aliasToReal` round-trips.
- Add one integration test in `shared/pii.test.ts` proving a string containing a Stellar
  secret + a known patient name + a drug is handled correctly by each of the three
  purpose functions without leaking across them.

### 5. Behavior differences intentionally fixed vs preserved

- **Preserved:** every regex/field-set/cap value is copied verbatim; no masking behavior
  changes. `sanitizeForResponse` keeps its exact char allow-list and 80-char cap.
- **Preserved:** `prompt-scrub` pseudonymization remains reversible server-side via the
  session map; it is *not* collapsed into `[PATIENT NAME]`.
- **Intentionally fixed (if found):** any pattern duplicated across the three modules
  becomes a single registry entry, eliminating drift. Today `redact.ts` and
  `prompt-scrub.ts` each maintain their own name lists — after consolidation there is one
  known-names registry shared by `redactForLogs` and `scrubForPrompt`.

## Open questions

- Keep the three old files as re-export shims for one release (easier external imports),
  then delete? Recommendation: yes, delete after the next minor to avoid breaking
  out-of-tree callers.
