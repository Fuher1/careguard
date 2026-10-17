# RFC 1441: Give `shared/` real package boundaries instead of relative-path imports

**Status:** Proposed
**Date:** 2026-08-27
**Issue:** [#1441](https://github.com/harystyleseze/careguard/issues/1441)

---

## Context

Today every `services/*/server.ts` (and `agent/server.ts`, `server.ts`) reaches into
`shared/` through raw relative paths such as
`import { logger } from "../../shared/logger.ts";` (see
`services/bill-audit-api/server.ts:28`, `services/drug-interaction-api/server.ts:20`,
`services/pharmacy-api/server.ts:19`). `pnpm-workspace.yaml` only configures
`allowBuilds` for `core-js`/`esbuild`/`sharp` and declares **no** `packages:` list, so
there is:

- no dependency graph — pnpm cannot tell which services depend on which shared modules;
- no per-package versioning or publish surface;
- no enforced *export surface* — any file inside `shared/` is importable from anywhere,
  so an accidental coupling (a service reaching into an internal helper that was meant to
  be private) is invisible until runtime.

This RFC proposes turning `shared/` into a first-class pnpm workspace package
(`@careguard/shared`) with an explicit `exports` map, so the importable surface is
declared in one place and accidental coupling becomes a build/type error.

## Trade-off

More upfront ceremony (`package.json`, `exports` map, per-service `package.json`
dependency, a codemod) versus today's zero-friction relative imports. The payoff is that
the *intended* public API of `shared/` is explicit and deviations are caught by the
type-checker and by workspace-aware tooling.

## Acceptance criteria

### 1. Document today's relative-import pattern and its lack of an enforced export surface

- **Pattern:** `services/<svc>/server.ts` and `server.ts`/`agent/server.ts` import
  `shared/*.ts` via `../../shared/<module>.ts` relative specifiers.
- **No export surface:** Every `.ts` file in `shared/` is reachable. There is no
  `index.ts` gate and no `exports` map, so a service can import an internal helper
  (e.g. `shared/__tests__/…` or a `_`-prefixed helper) just as easily as a public one.
- **No graph:** `pnpm-workspace.yaml` has no `packages:` entry for `shared`, so pnpm
  treats each service as an island and cannot resolve a shared dependency or detect
  cycles.

### 2. Propose a `shared/package.json` with an exports map

```json
// shared/package.json
{
  "name": "@careguard/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./agent-state": "./dist/agent-state.js",
    "./redis": "./dist/redis.js",
    "./redact": "./dist/redact.js",
    "./sanitize": "./dist/sanitize.js",
    "./pricing-sources": "./dist/pricing-sources.js",
    "./logger": "./dist/logger.js"
    // … one entry per intentionally public module
  }
}
```

Only modules listed in `exports` are importable from outside the package. Internal-only
helpers (anything under `__tests__/`, `_`-prefixed files) are simply omitted, making the
public contract self-documenting.

### 3. How `services/*/package.json` would declare the dependency

Each service gains a workspace dependency instead of a relative path:

```json
// services/bill-audit-api/package.json
{
  "dependencies": {
    "@careguard/shared": "workspace:*"
  }
}
```

and imports become package-specifier based:

```ts
// before
import { sanitizeUserString } from "../../shared/sanitize.ts";
// after
import { sanitizeUserString } from "@careguard/shared/sanitize";
```

The `.ts` extension is dropped at the boundary because the `exports` map points at the
built `.js`/`.d.ts` artifacts.

### 4. Migration plan (codemod for import paths, one service first)

1. **Add `shared` to the workspace.** Append to `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - "shared"
     - "services/*"
   ```
2. **Author `shared/package.json`** (above) plus a `shared/tsconfig.build.json` that emits
   `dist/` with declaration files.
3. **Write a codemod** (`scripts/codemod-shared-imports.ts`, run with `tsx`) that rewrites
   every `from "(\.\./)+shared/(.*?)\.ts"` in `services/**` and the root `*.ts` to
   `from "@careguard/shared/$2"` and adds the `workspace:*` dependency to the owning
   `package.json`.
4. **One-service-first pilot:** apply the codemod to `services/bill-audit-api` only, build
   `shared`, run `pnpm --filter @careguard/bill-audit-api typecheck` and its tests. This
   proves the `exports` surface is complete (any missing export fails the type-check).
5. **Roll out** to the remaining services, `agent/`, and root `server.ts` once the pilot is
   green, then delete the now-redundant relative reachability (e.g. ensure no
   `../../shared` specifiers remain via a lint rule).

### 5. CI implications (build order, workspace-aware type-checking)

- **Build order:** `shared` must be built (emit `dist/`) before any dependent service's
  type-check/test. Introduce a pnpm pipeline: `pnpm -r --filter "./shared..." build`
  followed by `pnpm -r build`, or rely on `pnpm` topological run.
- **Workspace-aware type-check:** switch CI from per-folder `tsc` to
  `pnpm -r typecheck` so cross-package boundary type errors surface.
- **Lint guard:** add a `no-restricted-imports` ESLint rule forbidding `**/shared/**`
  relative specifiers outside `shared/`, locking in the package boundary.
- **Caching:** `shared/dist` becomes a build artifact; ensure CI caches it between the
  build and test stages, or merge build+test into a single job per package.

## Open questions

- Do we keep `.ts` source in the `exports` map (for `tsx`/dev) or only ship built `.js`?
  Recommendation: ship built artifacts and have `shared` expose a `dev` script using
  `tsx` watch for local iteration.
