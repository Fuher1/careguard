# RFC 1444: Replace `shared/agent-state.ts` module-level pause flags with a Redis-backed store

**Status:** Proposed
**Date:** 2026-08-27
**Issue:** [#1444](https://github.com/harystyleseze/careguard/issues/1444)

---

## Context

`shared/agent-state.ts` stores pause state as plain module-level variables:

```ts
let paused = false;
let pausedReason: PauseReason | null = null;
let pausedAt: string | null = null;
```

The module's own doc comment (lines 5–8) admits this only works for a single-process
deploy: *"State is in-memory (single-process). For multi-process deploys this needs to
move to Redis…"*. Under a second server replica (horizontal scaling, e.g. multiple
Render instances behind a load balancer), each replica holds an **independent,
inconsistent** pause state — one replica pauses, the other keeps spending.

`shared/redis.ts` already exists and provides a `CacheClient` (`get`/`set`/`del`,
in-process fallback when `REDIS_URL` is unset) used elsewhere for shared mutable state.
This RFC proposes migrating pause state into Redis behind the **same**
`getAgentState`/`pauseAgent`/`resumeAgent`/`isPaused` interface.

## Trade-off

Adds a network round-trip (and a Redis-availability dependency) to every pause/resume
check, but makes horizontal scaling of the agent server correct: all replicas observe a
single source of truth.

## Acceptance criteria

### 1. Document the current module-level state and the multi-replica failure

See the code snippet above. `paused`/`pausedReason`/`pausedAt` are process-local. With N
replicas, a `pauseAgent()` call hitting replica A is invisible to replica B, so B
continues to service tool calls and spend. The current deploy (`render.yaml`, single
unified server) hides the bug, but any scale-out reintroduces it.

### 2. Redis key/value schema mirroring `AgentState`

Store the state as a single JSON blob under one key, mirroring the existing shape:

```
Key:    agent:state
Type:   string (JSON)
Value:  { "paused": boolean, "pausedReason": string|null, "pausedAt": string|null }
TTL:    none (pause is durable until explicitly resumed; matches today's semantics)
```

Optionally also expose `agent:state:paused` as a fast boolean for `isPaused()` hot paths,
but a single JSON key keeps the schema simple and consistent with `getAgentState()`.

### 3. Keep the existing function signatures stable

The public surface is unchanged:

```ts
export interface AgentState { paused: boolean; pausedReason: PauseReason | null; pausedAt: string | null; }
export function getAgentState(): Promise<AgentState>;
export function pauseAgent(reason: PauseReason): Promise<AgentState>;
export function resumeAgent(): Promise<AgentState>;
export function isPaused(): Promise<boolean>;
```

This is a **breaking async change** for the three callers (`shared/wallet-balance.ts:17`,
`server.ts:62`, `agent/server.ts`). Migration is mechanical: `await` the calls. The
in-process file persistence in `agent/server.ts:189` (`data/agent-state.json`) is a
separate concern and can be retained as a cold-start seed (see migration plan).

### 4. Fallback behavior when Redis is unavailable (fail open vs fail closed)

`shared/redis.ts` already falls back to an in-process `Map` when `REDIS_URL` is unset, but
**that fallback is also process-local** and reintroduces the multi-replica bug. Two modes:

- **`REDIS_URL` unset (dev / single process):** use the in-process fallback. Acceptable,
  matches today.
- **`REDIS_URL` set but Redis unreachable:** **fail closed** — `isPaused()` should return
  `true` (treat the agent as paused) so a Redis outage does not permit uncontrolled
  spending. `pauseAgent`/`resumeAgent` throw/log, and the caller (e.g.
  `wallet-balance.ts`) already treats a paused agent conservatively.

Concretely, wrap `redis.get` in a try/catch: on error, `getAgentState()` returns
`{ paused: true, … }` (fail closed) and logs, rather than silently returning `paused:
false`.

### 5. Migration plan with a feature flag to switch stores

1. Define `USE_REDIS_AGENT_STATE` env flag (default: follow `REDIS_URL`).
2. Implement `createRedisAgentStateStore(client)` and keep
   `createInMemoryAgentStateStore()` (current vars) as the fallback.
3. Add a factory `getAgentStateStore()` that selects the store based on the flag.
4. Convert the four exported functions into thin wrappers over the selected store.
5. Update the three call sites to `await` the now-async functions.
6. Optionally seed Redis from `data/agent-state.json` on cold start, then drop the file
   once Redis is the source of truth in all environments.
7. Ship behind the flag; enable per-environment; remove the in-memory store path once
   stable.

## Open questions

- Should `isPaused()` be cached locally with a short TTL to avoid a round-trip on every
  tool call? Recommendation: yes, a ~1s in-memory cache of the boolean, since pause
  transitions are rare.
