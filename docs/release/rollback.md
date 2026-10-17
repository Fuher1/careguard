# Rollback Procedure

This document describes how to rollback a bad deploy and the compatibility risks with data and state.

## Scope

- backend server rollback
- dashboard rollback
- Render rollback guidance
- JSON/JSONL and Redis compatibility risk
- rollback test checklist
- health and metrics signals for rollback validation

## Server rollback (Compose)

1. Identify the last known good commit or image tag.
2. Stop the failed service and restore the previous server image:
   - `docker compose pull <stable-image>` or
   - `docker compose up -d --no-deps --build --force-recreate <service>` using the stable revision.
3. Verify the old code is running with `curl http://localhost:3000/health`.
4. Confirm `/ready` returns `200` and the readiness checks pass.
5. Validate `/agent/spending` or another agent endpoint with the caregiver token.

## Server rollback (Render)

1. Open Render service dashboard.
2. Roll back to the previous successful deployment or commit.
3. Confirm environment variables are unchanged and `CAREGIVER_TOKEN` remains valid.
4. Verify health with `/health` and `/ready`.
5. Run smoke tests against `/agent` endpoints.

## Dashboard rollback

1. Revert the dashboard to the prior stable commit or deploy preview.
2. Confirm `NEXT_PUBLIC_API_URL` still points to the rolled-back backend.
3. Test the caregiver workflow end-to-end.

## Data compatibility risks

### JSON/JSONL store schema changes

- Rolling back code across a changed JSON/JSONL schema can break the older server.
- If the newer deployment added or renamed fields in `data/*.json` / `data/*.jsonl`, the rolled-back server may fail to parse or write data.
- Before rollback, compare the current `data/` schema with the older version.
- If incompatible, prefer a forward fix over code rollback.

### Redis and state schema changes

- Redis state is mutable and may evolve across releases.
- If a recent deploy changed Redis key names, value formats, or data structure, rolling back can lead to stale or invalid state.
- If Redis migrations are not backward compatible, do not rollback without state remediation.
- In practice, preserve Redis data and only rollback code when the old version can safely read the current keys.

## Rollback-test checklist

Before release, exercise rollback with a controlled test.

- [ ] Confirm ability to restore a previous backend revision.
- [ ] Confirm ability to restore a previous dashboard revision.
- [ ] Validate `data/` schema compatibility or identify migration safety.
- [ ] Validate Redis compatibility for the current branch.
- [ ] Execute smoke tests against `/health`, `/ready`, and `/agent`.
- [ ] Confirm the previous version can read current persisted state.
- [ ] Document the rollback path in the release notes.

## Health and metrics signals

- `/health` returns `200 OK`.
- `/ready` returns `200 OK` and reports no missing required env vars.
- `/agent` endpoints succeed with a valid caregiver token.
- No new `5xx` or auth-related error spikes in logs.
- Metrics scrapes succeed when `METRICS_TOKEN` is set.
- Application logs show the expected service version and healthy startup.

## Links

- `docs/release/hotfix-process.md`
- `docs/deployment/render.md`
