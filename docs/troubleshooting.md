# Operator Troubleshooting Guide

A symptom-to-resolution index for on-call operators. Each row is a starting
point, not the full fix — follow the link for diagnosis and remediation
steps. If nothing here matches, check
[docs/runbooks/README.md](runbooks/README.md) for the full runbook index.

## Run these first

Before chasing a specific symptom below, these commands establish the
overall health of the stack and often point straight at the right row:

```bash
# Service logs (swap 'server' for 'dashboard', 'redis', 'prometheus', 'grafana')
docker compose logs server --tail=200

# Liveness — is the process up at all?
curl -s localhost:3000/health

# Readiness — are dependencies (env, Horizon, OZ facilitator) healthy?
curl -s localhost:3000/ready | jq .

# Prometheus metrics — rate limits, queue depth, concurrent requests, etc.
curl -s localhost:3000/metrics | grep -E "ratelimit_hits_total|route_concurrent_requests|agent_waiting_jobs"
```

See [health-checks.md](observability/health-checks.md) for what `/health` vs
`/ready` each verify, and [metrics-catalog.md](observability/metrics-catalog.md)
for the full metric list.

## Symptom → Resolution

| Symptom | Likely cause | Where to look |
|---|---|---|
| **Agent spinner never resolves** (dashboard "Active"/"Paused" chip never updates after clicking run) | Agent run rate-limited or queued behind another long-running LLM call; or the request never got a response (server crash, event-loop block) | Check `docker compose logs server` for the request; check `route_concurrent_requests{route="agent_run"}` and `agent_waiting_jobs` via `/metrics`; confirm `/health` still returns `200` (a live-but-stuck process still answers `/health`, so a non-responding spinner with a healthy `/health` points at the LLM call itself — see [llm-config.md](agent/llm-config.md)) |
| **Repeated 402s** on a paid route (`/pharmacy/compare`, `/bill/audit`, `/drug/interactions`, `/pharmacy/order`) | Missing/expired payment proof, wallet underfunded, or the OZ facilitator is degraded and rejecting/timing out payment verification | Confirm the client is retrying with a valid `X-PAYMENT` header per the challenge body (see [openapi.yml](openapi.yml) `X402PaymentChallenge` schema); check wallet balance (row below); if the facilitator itself is the problem, see [x402-facilitator-down.md](runbooks/x402-facilitator-down.md) and [oz-facilitator-outage.md](runbooks/oz-facilitator-outage.md) |
| **Blank / stuck wallet balance** on the dashboard's Wallet tab | Horizon unreachable, wrong `NETWORK`/RPC config, or the agent wallet genuinely has zero balance | Check `/ready`'s `horizon` check; verify `AGENT_SECRET_KEY`/public key matches the funded testnet wallet; cross-check the balance directly on [stellar.expert](https://stellar.expert/explorer/testnet); if the agent has auto-paused for low balance, see [wallet-low.md](runbooks/wallet-low.md) |
| **Dashboard shows "Disconnected"** chip in the header | One or more of the agent-info, spending, or transactions API calls the dashboard polls is failing | Hover the source-health chip next to "Disconnected" in the header (`dashboard-header.tsx`) — it lists which specific source (Agent/Spending/Transactions) is erroring; check that service's logs and confirm the backend port the dashboard is configured to hit (`dashboard/.env.local`) matches a running instance |
| **Startup hangs / stalls on Horizon** | `https://horizon-testnet.stellar.org` (or configured RPC) is slow or unreachable at boot, and a dependency check is blocking startup | Check `/ready`'s `horizon` field; see [horizon-down.md](runbooks/horizon-down.md) for detection, in-doubt settlement verification, and recovery. Note the readiness check is hardcoded to testnet Horizon regardless of `NETWORK` — see the caveat in [health-checks.md](observability/health-checks.md) |
| **Missing / invalid env var** at boot (`OZ_FACILITATOR_API_KEY required`, `LLM_API_KEY required`, etc.) | A required secret is unset or malformed in `.env` | Run `npx tsx scripts/check-env-vars.ts`; check `/ready`'s `env` field for the exact missing-variable list; see [QUICKSTART.md](../QUICKSTART.md#troubleshooting) for where to obtain each key |
| **Groq / LLM provider 429** | LLM provider rate limit hit | See [QUICKSTART.md](../QUICKSTART.md#troubleshooting) — wait for reset or switch provider/model via `LLM_BASE_URL`/`LLM_API_KEY`; see [llm-config.md](agent/llm-config.md) |
| **`413` on `/bill/audit` or other routes** | Request body exceeds the configured size limit | See the `413` response documented per-route in [openapi.yml](openapi.yml); the limit is enforced before x402 payment is charged, so no funds are taken on a rejected oversized request |
| **`ENOSPC` / audit log write failures / disk pressure** | `data/` volume is full | See [disk-full.md](runbooks/disk-full.md) |
| **Redis warnings, cross-instance state inconsistency** | Redis unreachable or `REDIS_URL` unset — cache falls back to in-process memory | See [redis-down.md](runbooks/redis-down.md) |
| **Audit log verification fails / suspected tampering** | Hash chain broken | See [audit-log-tamper-detected.md](runbooks/audit-log-tamper-detected.md) |
| **Port already in use** during local dev | Leftover process from a previous run | See [QUICKSTART.md](../QUICKSTART.md#troubleshooting) port-cleanup commands |

## Related

- [docs/runbooks/README.md](runbooks/README.md) — full runbook index and the incident-response template each runbook follows
- [docs/error-codes.md](error-codes.md) — machine-readable error code registry referenced by API responses
- [docs/observability/health-checks.md](observability/health-checks.md) — `/health` vs `/ready` semantics
- [docs/observability/metrics-catalog.md](observability/metrics-catalog.md) — full Prometheus metric list
- [QUICKSTART.md](../QUICKSTART.md) — setup-time troubleshooting (env keys, faucets, port cleanup)
