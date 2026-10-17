# Secret Rotation SLA

`docs/runbooks/rotate-secrets.md` documents **how** to rotate each secret. This
doc defines **how often** and **how fast** — the cadence and response-time
commitments that make rotation auditable, rather than "whenever someone
remembers."

For the leak-response workflow itself (revoke → rotate → invalidate → clean
history), see [`docs/runbooks/leaked-secret.md`](../runbooks/leaked-secret.md).
For the step-by-step procedure per secret, see
[`docs/runbooks/rotate-secrets.md`](../runbooks/rotate-secrets.md).

---

## Rotation cadence and emergency RTO

| Secret | Env var(s) | Routine cadence | Emergency RTO (from confirmed/suspected leak) | Procedure |
|---|---|---|---|---|
| Agent wallet | `AGENT_SECRET_KEY` / `AGENT_PUBLIC_KEY` | Every 90 days | Begin within 1 hour; funds swept and new key live within 4 hours | [rotate-secrets.md §1](../runbooks/rotate-secrets.md#1-agent-wallet-agent_secret_key--agent_public_key) via `scripts/rotate-agent-wallet.ts --execute`, or the zero-downtime SIGHUP path in [rotate-agent-key.md](../runbooks/rotate-agent-key.md) |
| OZ Facilitator API key | `OZ_FACILITATOR_API_KEY` | Every 90 days | Begin within 1 hour; new key live and old key revoked within 4 hours | [rotate-secrets.md §2](../runbooks/rotate-secrets.md#2-oz-facilitator-api-key-oz_facilitator_api_key) |
| LLM API key | `LLM_API_KEY` | Every 90 days | Begin within 1 hour; new key live and old key revoked within 4 hours | [rotate-secrets.md §3](../runbooks/rotate-secrets.md#3-llm-api-key-llm_api_key) |
| MPP secret key | `MPP_SECRET_KEY` | Every 90 days | Begin within 1 hour; new key live within 4 hours (confirm no in-flight orders first — see note below) | [rotate-secrets.md §4](../runbooks/rotate-secrets.md#4-mpp-secret-key-mpp_secret_key) |
| JWT signing secret | *(not yet in use — see note below)* | Every 90 days, once introduced | Begin within 1 hour; dual-verify window completes within one access-token TTL (15 min) plus deploy time | [rotate-secrets.md §5](../runbooks/rotate-secrets.md#5-jwt-refresh-secret-when-auth-lands-in-10) |

**"Begin within 1 hour"** means: the person who confirms or reasonably
suspects a leak has started the rotation procedure (generated the new
credential and initiated the update) within 1 hour of confirmation — matching
the "Immediate triage (within 1 hour)" benchmark already used for CVE response
in [`docs/security/critical-dependencies.md`](./critical-dependencies.md), so
this doc doesn't introduce a second, inconsistent response-time standard.

**JWT is not yet applicable.** `docs/runbooks/rotate-secrets.md` §5 documents
the rotation procedure for a JWT signing secret only in anticipation of
authentication landing (tracked as issue #10) — no JWT secret exists in
`.env.example`, `render.yaml`, or anywhere in this codebase today. It's listed
here so the SLA table is complete against the same five secrets
`docs/SECURITY.md`'s Secret Rotation section already names, and so the 90-day
cadence and 1-hour emergency RTO apply automatically the moment #10 ships,
without this doc needing a follow-up edit.

## Emergency rotation trigger conditions

Rotate immediately — do not wait for the next routine window — when any of
the following occurs:

- The secret (or a Stellar `S...` seed) appears in a git commit, log line,
  error response, CI output, or any other place outside its intended env-var
  storage.
- A dependency in the payment path (see
  [`docs/security/critical-dependencies.md`](./critical-dependencies.md)) is
  found to be compromised or malicious, and that dependency has access to the
  secret at runtime.
- Unexplained or unauthorized activity is observed against the secret's
  resource — a wallet transaction the agent didn't initiate, an LLM/OZ usage
  spike outside normal patterns, or unexpected `/agent/*` traffic.
- A team member who held or could access the secret is offboarded, or a
  vendor console (Groq, OpenAI, OpenRouter, OpenZeppelin, Render) reports a
  breach that could have exposed it.
- Render Dashboard access (which holds every `sync: false` value — see
  below) is itself suspected compromised: rotate every secret it stores, not
  just the one directly implicated.

## Who is responsible

This repository has a single default owner in
[`.github/CODEOWNERS`](../../.github/CODEOWNERS) (`@harystyleseze`), so there
is no separate on-call rotation to name. In practice:

- **Whoever confirms or suspects the leak** is responsible for starting
  rotation within the 1-hour window above — do not wait to find "the right
  person"; anyone with Render Dashboard or provider-console access can and
  should act immediately per
  [`docs/runbooks/leaked-secret.md`](../runbooks/leaked-secret.md).
- **The repository owner** (per `CODEOWNERS`) is accountable for the routine
  90-day cadence actually happening — e.g. the recurring calendar reminder
  `docs/runbooks/rotate-secrets.md` already recommends — and for reviewing
  that each rotation's completion was logged (see "Audit trail" below).
- If a secret is provider-specific (e.g. `LLM_API_KEY`), whoever holds
  console access for that provider is responsible for revoking the old key
  there, in addition to updating the env var.

## `sync: false` restart/redeploy implication (Render)

Every secret in the table above is declared in `render.yaml` with
`sync: false` — required by Render so secret values live only in the Render
Dashboard, never in the committed blueprint. This has a direct consequence
for rotation completion, documented in full in
[`docs/runbooks/rotate-render-secrets.md`](../runbooks/rotate-render-secrets.md):

- **Render does not restart a running Web Service when a `sync: false`
  variable is changed in the Dashboard.** Updating the value alone is not
  enough — the running process keeps using the old value in memory until one
  of the two paths below runs.
- **Zero-downtime path** (agent wallet key only, today): send `SIGHUP` to the
  Node process (`kill -HUP $(pgrep -f "node.*server")`) to force an
  in-process signer-cache invalidation, confirmed by the
  `[x402] SIGHUP received — signer cache invalidated` log line.
- **Manual restart path** (everything else, or if `SIGHUP` isn't available):
  **Manual Deploy → Restart Service** (or **Clear Build Cache & Deploy**) in
  the Render Dashboard. Secrets evaluated only at process boot — which is all
  of them except the agent wallet's SIGHUP-aware path — are not live until
  this restart happens.
- A rotation is **not complete** until this restart/reload step has run and
  been smoke-tested (`docs/runbooks/rotate-render-secrets.md`'s own smoke-test
  section) — updating the Dashboard value alone leaves the emergency RTO
  clock running.

## Audit trail

`docs/runbooks/rotate-secrets.md` already asks for a dated entry in
`data/audit.log.jsonl` after each rotation. That entry is what makes routine
rotation *auditable* rather than just scheduled — this SLA doc defines the
target it should be checked against (was it within 90 days of the last
entry for that secret; was an emergency rotation started within 1 hour of the
triggering event).

## Related

- [`docs/runbooks/rotate-secrets.md`](../runbooks/rotate-secrets.md) — how to rotate each secret
- [`docs/runbooks/leaked-secret.md`](../runbooks/leaked-secret.md) — leak response workflow
- [`docs/runbooks/rotate-render-secrets.md`](../runbooks/rotate-render-secrets.md) — `sync: false` restart mechanics
- [`docs/security/critical-dependencies.md`](./critical-dependencies.md) — the 1-hour triage benchmark this doc's emergency RTO is aligned with
- [`docs/SECURITY.md`](../../SECURITY.md) — overall security policy and vulnerability reporting
