# RFC 1443: Split `shared/pricing-sources.ts` (979 lines) by pricing-source concern

**Status:** Proposed
**Date:** 2026-08-27
**Issue:** [#1443](https://github.com/harystyleseze/careguard/issues/1443)

---

## Context

`shared/pricing-sources.ts` is ~979 lines and mixes several concerns in a single module:

- **source-adapter definitions** (`StaticProvider`, `GoodRxProvider`, `CostcoRxProvider`),
- **normalization logic** (drug-name lowercasing, price adjustment),
- **caching** (in-memory `Map` with 24h TTL in `BasePricingProvider`),
- **comparison/scoring** (the comparison endpoint's ranking of returned prices).

Because everything lives in one file, a change to one source's drug database can silently
affect reasoning about unrelated sections, and the file is hard to review. This RFC
proposes splitting it into per-source adapter files plus a thin orchestration module, so
each pricing source becomes independently testable and reviewable.

## Trade-off

More files to navigate, but each source's database and logic is isolated. Existing public
API surface (`PricingProvider`, `BasePricingProvider`, `createPricingProvider`,
`StaticProvider`, `GoodRxProvider`, `CostcoRxProvider`) is preserved via a re-exporting
`index.ts`, so no call site changes are required.

## Acceptance criteria

### 1. Map the current file's sections (with line ranges)

| Section | Lines | Concern |
|---|---|---|
| `PricingProvider` interface + `PharmacyPrice` types | 1–16 | Public types |
| `CacheEntry` interface | 20–24 | Caching types |
| `BasePricingProvider` (cache get/set, `getCacheKey`) | 28–63 | Caching + normalization base |
| `StaticProvider` | 65–84 | Source adapter |
| `GoodRxProvider` (expanded drug DB, scraping-style pricing) | 85–778 | Source adapter (largest) |
| `CostcoRxProvider` | 784–961 | Source adapter |
| `createPricingProvider` factory | 965–979 | Orchestration/factory |

`GoodRxProvider` alone spans ~693 lines (85–778), almost entirely its hardcoded
`drugDatabase` map. That is the prime candidate for extraction.

### 2. Target module layout

```
shared/pricing-sources/
  index.ts            # re-exports public surface (PricingProvider, providers, factory)
  types.ts            # PricingProvider, PharmacyPrice, CacheEntry
  base-provider.ts    # BasePricingProvider (cache + normalization)
  static-provider.ts  # StaticProvider
  goodrx-provider.ts  # GoodRxProvider (+ its drugDatabase)
  costco-provider.ts  # CostcoRxProvider
```

`index.ts` preserves the current import contract so `shared/__tests__/pricing-sources.test.ts`
and `scripts/test-pricing-providers.ts` keep working unchanged:

```ts
// shared/pricing-sources/index.ts
export * from "./types.ts";
export * from "./base-provider.ts";
export * from "./static-provider.ts";
export * from "./goodrx-provider.ts";
export * from "./costco-provider.ts";
```

### 3. Shared interface each source adapter must implement

Unchanged from today — every adapter extends `BasePricingProvider`, which implements the
`PricingProvider` interface (`getPrices(drugName, zipCode?): Promise<PharmacyPrice[]>`).
The split only relocates the concrete classes; the interface contract is untouched.

### 4. Migration plan preserving the existing public API surface and tests

1. Create `shared/pricing-sources/` directory.
2. Move `PricingProvider`/`PharmacyPrice`/`CacheEntry` → `types.ts`.
3. Move `BasePricingProvider` → `base-provider.ts` (imports types from `./types.ts`).
4. Move `StaticProvider`, `GoodRxProvider`, `CostcoRxProvider` into their files; each
   imports `BasePricingProvider` from `./base-provider.ts` and types from `./types.ts`.
5. Replace `shared/pricing-sources.ts` with a thin `index.ts` that re-exports everything
   (so `import { GoodRxProvider } from "../shared/pricing-sources.ts"` still resolves).
   Alternatively, delete the old file and update its two importers (step below).
6. Run `pnpm --filter … typecheck` and `shared/__tests__/pricing-sources.test.ts`.

### 5. Existing tests that need path updates

- `shared/__tests__/pricing-sources.test.ts` — only if we drop the re-export shim; with the
  `index.ts` shim **no change is required**.
- `scripts/test-pricing-providers.ts` — imports from `../shared/pricing-sources.ts`;
  unchanged with the shim.

If we choose to fully delete the old file (preferred long-term), update the two importers
to `../shared/pricing-sources/index.ts` (or the new package path from RFC 1441).

## Open questions

- Should `GoodRxProvider`'s large `drugDatabase` move to its own `goodrx-database.ts`?
  Recommendation: yes, to keep `goodrx-provider.ts` focused on behavior.
