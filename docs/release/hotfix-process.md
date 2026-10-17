# Hotfix Process

This document describes the immediate process for a hotfix and includes rollback guidance.

## Rollback reference

If a deploy is broken, use the rollback procedure in `docs/release/rollback.md`.

## Immediate steps

1. Stop the broken deployment.
2. Roll back the backend and dashboard to the last known good revision.
3. Validate health and readiness probes.
4. Confirm critical agent endpoints with the caregiver token.
5. Review logs and metrics for the rollback result.

## Note

This document is intentionally brief; the detailed rollback steps are maintained in `docs/release/rollback.md`.
