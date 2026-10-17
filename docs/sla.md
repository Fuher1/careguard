# SLA and Uptime Targets

This document states CareGuard's availability targets, defines what "downtime" means per service tier, documents the third-party dependency caveats that bound achievable uptime, and states the maintenance-window policy.

---

## Availability Target

| Tier | Target | Measurement window | Monthly allowed downtime |
|------|--------|--------------------|--------------------------|
| **Agent (autonomous payment operations)** | 99.5% | 30-day rolling | ≤ 3h 39m |
| **Dashboard (read-only caregiver view)** | 99.9% | 30-day rolling | ≤ 43m |
| **Price/audit/drug-interaction APIs** | 99.0% | 30-day rolling | ≤ 7h 18m |

> These targets apply to the CareGuard application layer only. They do not include time where the service is unavailable solely due to third-party dependency outages listed in the [Dependency Caveats](#dependency-caveats) section below — those outages reduce the achievable ceiling and are called out separately.

---

## Downtime Definitions

### Agent (autonomous payment operations)

| State | Definition | Counts as downtime? |
|-------|------------|---------------------|
| **Unavailable** | `/agent/run` returns 5xx or is unreachable | Yes |
| **Degraded** | `/ready` returns `{"status":"degraded"}` — agent can accept requests but at least one dependency check fails (e.g. Horizon unreachable, env missing) | Yes, if new agent runs cannot complete |
| **Policy-blocked** | Agent is running but rejects a specific task due to spending policy limits or approval threshold | No — this is expected behaviour, not downtime |
| **Queue saturated** | `agent_waiting_jobs` exceeds concurrency cap; new requests are queued but not dropped | No — requests are queued, not lost |

### Dashboard (caregiver UI)

| State | Definition | Counts as downtime? |
|-------|------------|---------------------|
| **Unavailable** | Dashboard returns 5xx or is unreachable | Yes |
| **Read-only degraded** | Dashboard loads but cannot submit agent tasks (agent backend is down) | Partial — the agent downtime is counted against the agent SLA, not the dashboard SLA |
| **Stale data** | Dashboard shows cached data while the agent API is slow | No — UX degradation, not downtime |

### Price / Audit / Drug-Interaction APIs

| State | Definition | Counts as downtime? |
|-------|------------|---------------------|
| **Unavailable** | Service returns 5xx or is unreachable | Yes |
| **x402 payment rejected** | The OZ Facilitator rejects a payment settlement | Yes — the API call cannot complete |
| **Slow** | Response time > 10s | No — counted as latency, tracked via `p99` SLI |

---

## Measurement

- Availability is measured as `1 - (downtime_seconds / window_seconds)` over the 30-day rolling window.
- Downtime is defined as any period during which the health probe fails continuously for > 1 minute (to exclude transient flaps).
- The canonical measurement source is the Prometheus SLI recording rules in [`docker/prometheus/recording-rules.yml`](../docker/prometheus/recording-rules.yml).
- SLO targets and error-budget policy are defined in [`docs/observability/slo.md`](./observability/slo.md).

---

## Dependency Caveats

CareGuard's achievable uptime is bounded by the availability of the following third-party services. Outages in these services are tracked but do not count against CareGuard's own SLA targets.

| Dependency | Role | Known availability | Impact if down |
|------------|------|--------------------|----------------|
| **Stellar Horizon** (testnet: `horizon-testnet.stellar.org` / mainnet: `horizon.stellar.org`) | Stellar network gateway — required for all payments (x402, MPP, direct USDC) | ~99.5% (community-operated testnet) | No payments can be submitted or verified; agent runs that require payment will fail |
| **OZ Facilitator** (`channels.openzeppelin.com`) | x402 payment settlement — required for pharmacy-price, bill-audit, and drug-interaction API calls | Not published | All x402-gated API calls fail; agent cannot query prices, audits, or drug interactions |
| **LLM provider** (Groq / OpenRouter / OpenAI, configured via `LLM_API_KEY` + `LLM_BASE_URL`) | AI decision engine | Varies by provider | Agent cannot make autonomous decisions; `/agent/run` returns an LLM error |
| **Render** (hosting platform) | Compute and networking | ~99.95% (per Render status page) | All services unreachable |
| **Redis** (optional, `REDIS_URL`) | Rate-limiting and distributed queue | N/A if not configured | Rate-limiting falls back to in-memory; queue depth capped at process memory |

### Composite Ceiling

If each dependency above has independent availability, the theoretical maximum CareGuard availability for full agent operation (payment + AI) is approximately:

```
0.995 (Horizon) × 0.995 (OZ Facilitator, estimated) × 0.99 (LLM, estimated) × 0.9995 (Render)
≈ 97.95%
```

This composite figure means the 99.5% agent SLA target is achievable only with redundancy or circuit-breaking for each dependency. Refer to the relevant runbooks for fallback behaviour:

- [docs/runbooks/oz-facilitator-outage.md](./runbooks/oz-facilitator-outage.md)
- [docs/runbooks/x402-facilitator-down.md](./runbooks/x402-facilitator-down.md)
- [docs/runbooks/switch-network.md](./runbooks/switch-network.md)

---

## Maintenance-Window Policy

### Planned Maintenance

- **Advance notice:** at least 48 hours via the project's GitHub Discussions and/or the caregiver-facing communication channel (if configured).
- **Preferred window:** weekdays 02:00–04:00 UTC (lowest observed traffic).
- **Duration cap:** planned maintenance windows must not exceed 2 hours. If the work cannot be completed in 2 hours, abort and reschedule.
- **Planned downtime does not count against the monthly availability target**, provided:
  - Notice was given ≥ 48 hours in advance.
  - The actual downtime did not exceed the announced duration by more than 15 minutes.

### Emergency Maintenance

- Emergency patches (security vulnerabilities, data-loss risk) may be applied without advance notice.
- Post-incident review must be completed within 5 business days and linked from the incident record.
- Emergency downtime **does count** against the monthly availability target.

### Communication Channel

Planned-maintenance announcements are posted to:

1. GitHub Discussions in the `careguard` repository (tag: `maintenance`)
2. Any configured webhook endpoint (`NOTIFICATION_WEBHOOK_URL` in `.env`) — see [`shared/notifications.ts`](../shared/notifications.ts)

---

## Related

- [docs/observability/slo.md](./observability/slo.md) — quantitative SLO targets, error budgets, and alert mappings
- [docs/observability/health-checks.md](./observability/health-checks.md) — `/health` and `/ready` response schemas
- [docs/release/production-readiness.md](./release/production-readiness.md) — go-live checklist including dependency verification
- [docs/runbooks/README.md](./runbooks/README.md) — runbook index for dependency outages
