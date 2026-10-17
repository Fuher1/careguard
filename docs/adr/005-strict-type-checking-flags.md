# ADR-005: Deferred Adoption of `noUncheckedIndexedAccess` and `noImplicitOverride`

- **Status:** Proposed
- **Date:** 2026-08-27

## Context

Both `tsconfig.json` and `dashboard/tsconfig.json` already set `"strict": true`. A comment on line 2 of each file additionally flagged two compiler options that are **not** part of the `strict` umbrella and must be opted into individually:

- **`noUncheckedIndexedAccess`** (TypeScript 4.1+) — adds `undefined` to the result type of any index-signature access (e.g. `record[key]`, `array[i]`), forcing an explicit check before use instead of assuming the value is present.
- **`noImplicitOverride`** (TypeScript 4.3+) — requires the `override` keyword on any subclass member that overrides a base class member, so a base class rename or removal surfaces as a compile error instead of silently detaching the override.

The comment read `// TODO: consider enabling noUncheckedIndexedAccess and noImplicitOverride in future ADR`, with no link to an actual decision record, since 2026-06-27 (root) / 2026-06-28 (dashboard). It never resolved into a decision (issue #1474).

## Decision

**Defer enabling both flags for now.** Neither flag changes runtime behavior, but each is a non-trivial adoption:

- `noUncheckedIndexedAccess` turns every existing indexed access without a prior narrowing check into a new compile error. This codebase uses index/bracket access in multiple places (e.g. dictionary-style lookups in `shared/`, `agent/tools.ts`, and dashboard components) that would need per-call-site review, not a blanket suppression.
- `noImplicitOverride` requires auditing every subclass method across the codebase and adding `override` where it's a genuine override, which is comparatively lower-risk but still a distinct, reviewable change on its own.

Bundling either flag into an unrelated change would obscure the diff and make review harder. This ADR formally records the option, its rationale, and what enabling it would require, so it can be picked up as dedicated, reviewable work instead of remaining an unlinked comment.

This decision does not change either `tsconfig.json`'s `compilerOptions`.

### Related tracked work

Issue #573 ("Enable `noUncheckedIndexedAccess` in dashboard tsconfig") already tracks the `noUncheckedIndexedAccess` half of this decision specifically for `dashboard/tsconfig.json`, naming concrete unguarded call sites (`DASHBOARD_TABS[newIndex]` in `dashboard-tabs-nav.tsx`, `lineItems[virtualItem.index]` in the bill-line-items virtualizer). That issue remains the actionable ticket for enabling the flag in the dashboard project. This ADR additionally covers the root `tsconfig.json` (not in scope of #573) and `noImplicitOverride` for both projects (not in scope of #573 either), neither of which currently has a tracked issue of its own.

## Consequences

### Positive
- Replaces an unlinked TODO with a discoverable, permanent decision record (this repo's established pattern per `docs/adr/README.md`).
- Anyone picking up the flag later has the rationale and scope already written down, instead of having to reconstruct it.

### Negative
- The type-safety benefits of both flags (catching out-of-bounds/dictionary access and detached overrides) remain unrealized until each is separately adopted.

### Neutral
- Enabling either flag is future work, not scoped here. Each should land as its own change: enable the flag, run `tsc --noEmit` in the affected project, and fix every resulting error at its call site (not via a blanket type assertion).

## Compliance

Not applicable — this ADR records a deferral, not an enforced rule. When either flag is later enabled, compliance is `tsc --noEmit` passing cleanly in the affected `tsconfig.json`.
