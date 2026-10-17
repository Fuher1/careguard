# Dashboard components

Shared UI lives here, split between leaf primitives and per-tab compositions.

## Layout

- `primitives/` — small, reusable building blocks. No knowledge of the dashboard
  page layout or app state. Examples: `Card`, `Bar`, `Btn`, `TxLink`,
  `LiveRegion`, `Toast`, `ConfirmDialog`, `BillLineItemsVirtualized`.
- `ui/` — generic, reusable UI kit/component library elements (e.g. vendored
  or utility-based presentation blocks). Examples: `Skeleton`, `Toaster`.
- `tabs/` — one file per tab on the main page (`overview-tab.tsx`,
  `medications-tab.tsx`, `bills-tab.tsx`, `policy-tab.tsx`, `wallet-tab.tsx`,
  `activity-tab.tsx`, `settings-tab.tsx`). Each is a presentational component
  that takes the slice of state it needs as props.
- `types.ts` — types shared across the app shell and tabs (`AgentResult`,
  `AgentInfo`, `AgentLogEntry`, `Tab`, etc.). Domain types stay in
  [`../lib/types.ts`](../lib/types.ts).

## State

App-wide state and side effects are owned by
[`../hooks/use-agent-state.ts`](../hooks/use-agent-state.ts). The main page
calls the hook once and passes the relevant slice to each tab. Tabs only own
local UI state (a confirm-dialog open flag, a "show errors only" toggle, etc).

## Adding a new tab

1. Add the tab name to `DASHBOARD_TABS` in `types.ts`.
2. Create `tabs/<name>-tab.tsx` exporting a `<NameTab />` presentational
   component.
3. If the tab needs new server state, add it to `use-agent-state.ts` and
   surface it through the hook's return value.
4. Wire the tab into `app/page.tsx`'s tab switch.

## Conventions

- Tabs accept the data they render plus callbacks for any mutations. They never
  call `fetch` directly — that belongs in the hook so it can stay testable.
- Primitives must not import from `tabs/` or `app/`. Tabs may import primitives.
- `ui/` vs `primitives/`:
  - Components in `ui/` are generic, off-the-shelf, or vendored layout elements (e.g. generic UI kit items like skeletons or notifications wrappers) that are completely application-agnostic.
  - Components in `primitives/` are hand-rolled, custom-tailored building blocks specific to CareGuard's domain UI needs (e.g. `TxLink`, `ConfirmDialog`, `BillLineItemsVirtualized`). They are presentational and have no knowledge of the global application state, but represent our custom UI design language rather than generic UI framework elements. `primitives/` components may import from `ui/`.
- Keep `app/page.tsx` under ~250 lines. If a tab grows large, split it further
  inside `tabs/<name>/`.

## Testing

Test files live in [`src/__tests__/`](../__tests__/) alongside the rest of the
dashboard test suite.  When adding a new test, place it in that directory and
use a relative import from `../components/…` to reach the module under test.
This keeps a single glob (`src/**/*.test.{ts,tsx}`) sufficient for running all
dashboard tests.
