# Runbook: Redis unavailable — degraded shared-state behaviour

**Symptom**

The server logs a warning at boot (or on first cache access if `REDIS_URL` is
set but unreachable):

```
REDIS_URL not set — using in-process cache. State is not shared across instances and is lost on restart.
```

or, when `REDIS_URL` is set but the connection itself is failing:

```
redis connection error { err: "..." }
redis get error { err: "..." }
redis set error { err: "..." }
```

There is no crash and no 5xx spike directly attributable to this — `shared/redis.ts`
is designed to degrade quietly, which is exactly what makes it dangerous to miss.

**Impact**

`shared/redis.ts` exports a `CacheClient` (`get`/`set`/`incr`/`del`/`acquireLock`).
Today the only consumer wired into the request path is **webhook replay
protection** (`shared/verify-webhook.ts`), which uses `cache.get`/`cache.set`
under the `webhook:seen:<id>` key to reject duplicate `X-Webhook-Id` deliveries
within a 10-minute window.

| Mode | Behaviour |
|---|---|
| `REDIS_URL` set, Redis reachable | Replay keys are shared across all server instances/processes. A webhook replayed to a different instance than the one that first saw it is still caught. |
| `REDIS_URL` unset, or Redis unreachable | Falls back to `createInMemoryClient()` — a plain in-process `Map`. Replay keys exist **only in the process that saw the original request.** |

Consequences of the in-memory fallback:

- **Replay protection stops working across instances.** In any multi-instance
  or multi-process deployment (e.g. horizontally scaled Render/Docker
  services, or a separate cron/worker process), a webhook delivered twice to
  two different instances is treated as two distinct events instead of one
  idempotent no-op.
- **State does not survive a restart.** A process restart empties the `Map`,
  so replay history resets to empty — a webhook redelivered by the sender
  after a deploy will not be recognized as a duplicate even on the *same*
  logical instance.
- **No cross-instance locking.** `acquireLock` only prevents concurrent access
  within a single process; it provides no mutual exclusion across instances
  when Redis is down.

> **Not affected by this fallback:** the agent pause flag (`shared/agent-state.ts`)
> and the MPP payment-plan store (`services/pharmacy-payment/*` →
> `data/mpp-store.json`) are **not** backed by `shared/redis.ts` — they are
> in-process module state and a JSON file on disk, respectively. Neither
> degrades when Redis is down. If you see stale pause state or MPP
> inconsistency, look at process restarts or file-system issues (see
> [disk-full.md](disk-full.md)) instead of Redis.

On a single-instance deployment (the current default — see
[ADR-003](../adr/unified-vs-split-server.md)), the practical blast radius is
limited to: a webhook redelivered after a process restart will be reprocessed
instead of deduplicated. On a scaled-out deployment, replay protection is
effectively disabled for cross-instance duplicates for as long as Redis stays
down.

**Diagnosis**

1. **Boot-time warning.** Grep server logs for the fallback message:
   ```bash
   docker compose logs server | grep "using in-process cache"
   ```
   If present, `REDIS_URL` was never configured for this instance — this is
   the expected default in single-instance/testnet setups, not necessarily an
   incident.

2. **Runtime connection errors.** If `REDIS_URL` *is* set but Redis itself is
   unreachable, `ioredis`'s `error` listener fires on every reconnect attempt:
   ```bash
   docker compose logs server | grep -E "redis (connection|get|set|incr|del|acquireLock) error"
   ```
   Each cache operation catches its own error and logs it individually
   (`shared/redis.ts`), so a Redis outage shows up as a steady stream of these
   lines rather than a single fatal error — the process keeps running.

3. **Confirm the effective mode.** There is no `/ready` check for Redis today
   (see [health-checks.md](../observability/health-checks.md) for what `/ready`
   *does* check). To confirm which client is active, check the environment
   directly:
   ```bash
   docker compose exec server sh -c 'echo REDIS_URL=$REDIS_URL'
   ```
   Empty output means every instance is on the in-memory fallback by design.

4. **Confirm duplicate webhook processing.** If you suspect replay protection
   silently failed, check the audit log for two entries with the same
   upstream event/webhook id close together:
   ```bash
   grep '"webhookId"' data/audit.log.jsonl | tail -20
   ```

**Mitigation**

- If this is a genuine Redis outage (was working, now isn't): no immediate
  action is required to keep the service up — the fallback keeps webhook
  processing functional on a single instance. The risk is silent duplicate
  processing on multi-instance deployments, not downtime.
- If webhook duplicate-delivery risk is unacceptable while Redis is down,
  consider temporarily routing all webhook traffic to a single instance
  (disable the others) until Redis recovers, so the in-memory replay cache is
  at least consistent for that instance.

**Remediation**

1. **Restore Redis connectivity.** Fix the underlying infra issue (Redis
   process down, network partition, auth/TLS misconfiguration, wrong
   `REDIS_URL`).
2. **No explicit reconnect step is needed in the app.** `ioredis` reconnects
   automatically; once `redis connection error` lines stop appearing, the
   `CacheClient` returned by `createRedisClient` is live again — there is no
   separate "switch back" flag to flip.
3. **Restart is only required if the fallback was chosen at boot.** The
   default client is a lazy singleton (`getDefaultClient()` in
   `shared/redis.ts`) selected once, the first time it's needed, based on
   whether `REDIS_URL` was set *at that time*. If you add or fix `REDIS_URL`
   on a running instance, you must restart the process — the singleton will
   not re-evaluate the env var on its own.
4. **Manual state reconciliation after recovery.** There is no cross-instance
   state to reconcile: the in-memory fallback never wrote anything Redis needs
   to catch up on, and vice versa. The only residual risk is any webhook
   deliveries that were duplicate-processed while instances were running
   disjoint in-memory replay caches — cross-reference `data/audit.log.jsonl`
   for the affected window against the upstream provider's delivery log if you
   need to confirm no duplicate side effects (e.g. duplicate payment
   confirmations) occurred.
5. **Multi-instance deployments:** once confirmed stable, ensure `REDIS_URL`
   is set identically on every instance so replay protection is consistently
   shared — see `.env.example` and [ADR-003](../adr/unified-vs-split-server.md)'s
   note on Redis-backed rate limiting for the same consideration applied to a
   different subsystem.

**Post-mortem template**

- Date / duration:
- Root cause:
- Detection lag:
- Mitigation taken:
- Remediation:
- Action items:

## Related

- `shared/redis.ts` — `CacheClient`, in-memory fallback, singleton selection
- `shared/verify-webhook.ts` — the only current consumer of the cache client
- [ADR-003: Unified vs. Split Server](../adr/unified-vs-split-server.md) — notes Redis-backed rate limiting as a future, not-yet-activated option for multi-instance deployments
- [disk-full.md](disk-full.md) — file-backed state (MPP store, spending/orders) that is *not* affected by Redis availability
- [health-checks.md](../observability/health-checks.md) — what `/ready` does and does not verify today
