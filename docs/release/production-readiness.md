# Production-Readiness Checklist

Use this checklist before routing live traffic to any CareGuard deployment. Each item links to the relevant runbook or doc. **All gates must be checked before a mainnet cutover.**

---

## 1. Testnet → Mainnet Cutover Gates

These must flip from testnet to mainnet values before going live with real USDC.

- [ ] `STELLAR_NETWORK` set to `mainnet` (not `testnet`) — see [`shared/network-mode.ts`](../../shared/network-mode.ts) and [`docs/runbooks/switch-network.md`](../runbooks/switch-network.md)
- [ ] `HORIZON_URL` points to `https://horizon.stellar.org` (not `horizon-testnet.stellar.org`) — verify in `.env` and `render.yaml`
- [ ] USDC issuer address updated to the mainnet Circle issuer (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`) — see [`shared/stellar-network.ts`](../../shared/stellar-network.ts)
- [ ] `MOCK_NETWORK` is **unset or `0`** — `assertMockNetworkAllowed()` in `shared/network-mode.ts` throws if `MOCK_NETWORK=1` and `NODE_ENV=production`
- [ ] Agent wallet (`AGENT_SECRET_KEY`) is funded with real USDC on mainnet — verify with `npm run check:wallet-balance`
- [ ] OZ Facilitator API key (`OZ_FACILITATOR_API_KEY`) is a production key, not a testnet key — confirm with OZ/x402 dashboard
- [ ] `NODE_ENV=production` is set in every service's environment

---

## 2. Security

- [ ] All secrets are stored in environment variables, not in source code — see [`.env.example`](../../.env.example) for the full list
- [ ] No `.env` file committed to the repo (`.gitignore` excludes it) — run `git status` to confirm
- [ ] JWT secret (`CAREGIVER_TOKEN`) is rotated from the default — see [`docs/runbooks/rotate-secrets.md`](../runbooks/rotate-secrets.md)
- [ ] Agent wallet secret (`AGENT_SECRET_KEY`) is stored as a Render secret env var (not a plain env var) — see [Render deployment](../deployment/render.md)
- [ ] CORS origin allowlist (`CORS_ALLOWED_ORIGINS`) is set to the production dashboard URL only — see [`docs/security/cors.md`](../security/cors.md) and [`shared/cors.ts`](../../shared/cors.ts)
- [ ] HTTP security headers are active (Helmet is mounted via `shared/security-middleware.ts`) — verify by checking response headers on `GET /health`
- [ ] HSTS (`Strict-Transport-Security`) is active — only applies when `NODE_ENV=production`; confirm in [`docs/SECURITY.md`](../SECURITY.md)
- [ ] CSP `connect-src` allowlist does not include testnet Horizon — update if it does; see [`docs/runbooks/csp-changes.md`](../runbooks/csp-changes.md)
- [ ] Authentication is enforced on `/agent/run` (`CAREGIVER_TOKEN` bearer check) — see [`shared/auth.ts`](../../shared/auth.ts)
- [ ] Gitleaks secret scan is passing in CI — see [`.github/workflows/gitleaks.yml`](../../.github/workflows/gitleaks.yml)
- [ ] CodeQL scan is passing with no high/critical findings — see [`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml)

---

## 3. Observability

- [ ] `SENTRY_DSN` is set and the Sentry project is configured for the production environment — see [`docs/observability/sentry.md`](../observability/sentry.md)
- [ ] `SENTRY_ENVIRONMENT=production` is set
- [ ] Sentry alert rules are configured for 5xx error spikes
- [ ] Prometheus metrics endpoint (`/metrics`) is accessible to the scrape target — see [`docs/observability/metrics-catalog.md`](../observability/metrics-catalog.md)
- [ ] Grafana dashboards are loading data (not "No data") — see [`docs/observability/dashboard-guide.md`](../observability/dashboard-guide.md)
- [ ] SLO recording rules are deployed and evaluated — see [`docs/observability/slo.md`](../observability/slo.md)
- [ ] Alert rules for all five SLOs are active (agent run success, Stellar tx success, payment settlement, LLM error rate, agent availability)
- [ ] `GET /health` returns `200` and `GET /ready` returns `{"status":"ok"}` — see [`docs/observability/health-checks.md`](../observability/health-checks.md)
- [ ] Correlation ID logging is working (`x-request-id` header propagated) — see [`docs/observability/correlation-ids.md`](../observability/correlation-ids.md)
- [ ] Log retention covers at least 30 days (the SLO window) — see [`docs/observability/prometheus-retention.md`](../observability/prometheus-retention.md)

---

## 4. Data and Backups

- [ ] `data/` directory is excluded from the container image (`.dockerignore` includes `data/`) — see [`.dockerignore`](../../.dockerignore)
- [ ] Spending log (`data/spending.jsonl`) and order log (`data/orders.jsonl`) are backed up to durable storage if retention is required — see [`docs/data/storage.md`](../data/storage.md)
- [ ] Audit log (`data/audit.log.jsonl`) is backed up — it is the integrity record for all financial operations
- [ ] `data/` is not committed to version control (`.gitignore` excludes it) — see [`.gitignore`](../../.gitignore) and [`docs/adr/002-pii-in-persistence.md`](../adr/002-pii-in-persistence.md)
- [ ] A backup/restore procedure exists and has been tested for the `data/` directory
- [ ] Prometheus data is retained for ≥ 30 days — verify `--storage.tsdb.retention.time` in the Prometheus config

---

## 5. Payment Configuration

- [ ] Spending policy limits are configured for the production environment (daily/monthly limits, per-category budgets, approval threshold) — see [`docs/agent/policy.md`](../agent/policy.md) and [`docs/SPENDING-POLICY.md`](../SPENDING-POLICY.md)
- [ ] Approval threshold (`approvalThreshold`) is set to a sensible value (default $75) — payments above this require caregiver approval before execution
- [ ] `MAX_TOOL_CALLS_PER_RUN` is set to a reasonable cap (default 30) to prevent runaway agent cost — see [`docs/SECURITY.md`](../SECURITY.md)
- [ ] x402 payment flow tested end-to-end on mainnet before routing caregiver traffic — at minimum: one price query, one drug interaction check, one bill audit
- [ ] MPP Charge flow tested end-to-end on mainnet for at least one medication order
- [ ] Direct Stellar USDC transfer tested on mainnet for at least one bill payment
- [ ] Agent wallet balance is sufficient for expected daily operational costs (x402 query fees + buffer)

---

## 6. Deployment and Build

- [ ] Build passes cleanly (`npm run build` exits 0, `dist/server.js` exists) — see [`docs/deployment/render.md`](../deployment/render.md)
- [ ] TypeScript type-check passes (`npm run typecheck` exits 0)
- [ ] All CI checks green on the release commit (lint, typecheck, unit tests, security scan)
- [ ] Docker image builds without errors (`docker build .`)
- [ ] Docker health checks pass on all services — see README health-check table
- [ ] Render deploy hook is configured and a deploy was triggered from the release tag

---

## 7. Documentation and Communication

- [ ] `CHANGELOG.md` has been updated for this release (auto-updated by the release workflow on tag push)
- [ ] [`docs/release/compatibility-matrix.md`](./compatibility-matrix.md) has a row for this release version
- [ ] Maintenance window (if any) has been communicated per the policy in [`docs/sla.md`](../../docs/sla.md)
- [ ] On-call engineer is aware a production deployment is happening

---

## Signing Off

Before routing traffic, the engineer performing the deployment should initial each section above. For significant releases (MAJOR or MINOR bumps), a second reviewer sign-off is required.

| Section | Checked by | Date |
|---------|-----------|------|
| Testnet → Mainnet Cutover | | |
| Security | | |
| Observability | | |
| Data and Backups | | |
| Payment Configuration | | |
| Deployment and Build | | |
| Documentation | | |

---

## Related

- [versioning.md](./versioning.md) — release process and tagging
- [compatibility-matrix.md](./compatibility-matrix.md) — SDK and Node version requirements
- [docs/deployment/render.md](../deployment/render.md) — build artifact pipeline
- [docs/sla.md](../../docs/sla.md) — uptime targets and maintenance-window policy
- [docs/SECURITY.md](../SECURITY.md) — full security model
- [docs/runbooks/switch-network.md](../runbooks/switch-network.md) — testnet ↔ mainnet switching runbook
