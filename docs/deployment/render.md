# Render Deployment and Rollback

This document covers Render-specific deployment and rollback guidance.

## Rollback guidance

If a Render deploy fails, roll back to the previous successful deploy using the Render dashboard.

- Open the service in Render.
- Select the last known good deployment.
- Trigger the rollback action.
- Confirm the backend is running and environment variables are correct.
- Verify `/health`, `/ready`, and `/agent` endpoints.

## Deployment notes

- Ensure `NEXT_PUBLIC_API_URL` points to the active backend.
- Keep `CAREGIVER_TOKEN` and `METRICS_TOKEN` in Render secrets.

## Links

- `docs/release/rollback.md`
- `docs/release/hotfix-process.md`
