# Threat Model Review Cadence

## Ownership

The CareGuard security model is owned by the core engineering team and the security documentation maintainer.

- Primary owner: core maintainers responsible for production releases.
- Review author: the engineer or security maintainer who updates `docs/SECURITY.md`.
- Outcome tracking: issues or PRs should include the `security-review` label and a changelog/PR note.

## Review cadence

- Regular review every quarter.
- Review ahead of each major release.
- Review before any public mainnet cutover.

## Event triggers for out-of-cycle review

A new threat-model review must occur when any of the following happen:

- new agent tool is added
- new external integration or third-party API is added
- new externally reachable endpoint is exposed
- major auth/authZ change is introduced
- a production incident reveals a new attacker capability
- mainnet or live-money deployment is planned

## Review checklist

1. Confirm the current asset inventory:
   - `/agent/*` endpoints
   - `/metrics`, `/health`, `/ready`
   - `data/` JSON/JSONL stores and Redis-derived state
   - external tool integrations and payment flows
2. Re-evaluate attacker capabilities:
   - token leakage
   - prompt injection via task input
   - unauthorized payments
   - environment secret exposure
3. Validate current defenses:
   - bearer token validation and tunnel protections
   - HTTPS + security headers
   - spending policy and approval gates
   - logging and audit trails
4. Identify coverage gaps and residual risks.
5. Document any changes in `docs/SECURITY.md` or a linked ADR.

## Recording outcomes

- Document review notes in a GitHub issue or PR.
- Add `security-review` or `threat-model-review` label to the issue/PR.
- Add a short entry to the release notes/changelog when a review influences code or configuration.

## Related docs

- `docs/SECURITY.md`
- `docs/security/authn-authz.md`
- `docs/security/disclosure-policy.md`
