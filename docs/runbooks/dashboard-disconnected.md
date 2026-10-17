# Runbook: Dashboard Disconnected

**Symptom**

- The dashboard top header displays a red status chip with **"Disconnected"** instead of **"Active"** or **"Paused"**.
- A red chip labeled **"Data issue"** may appear in the header next to the status chip, showing failing data sources (e.g. `Agent`, `Spending`, or `Transactions`) upon hovering.
- Action logs or toasts in the dashboard show connectivity errors (e.g. `"Agent not connected. Start services with: npm run dev"` or `"Failed to fetch"`).
- The browser developer console (F12) displays:
  - Failed HTTP requests (`net::ERR_CONNECTION_REFUSED` or `5xx` / `4xx` responses) to the `AGENT_URL` paths (e.g., `POST /agent/run`, `GET /agent/spending`, `GET /agent/transactions`, `GET /agent/wallet`).
  - Errors related to EventSource or SSE, e.g. `EventSource failed to connect` or connection timeouts.
  - CORS errors such as `Access-Control-Allow-Origin header is missing` or `blocked by CORS policy: Response to preflight request doesn't pass access control check`.

---

**Impact**

- The caregiver cannot view the real-time status of the care recipient, including current spending limits, active medications, historical transactions, or the live agent activity log.
- Attempting to run the AI agent (e.g., comparing prices, auditing medical bills) fails immediately with error notifications.
- The dashboard shows stale/cached UI state or fails to load data entirely.

---

**Diagnosis**

1. **Verify `AGENT_URL` Configuration**
   - Check if the environment variable `NEXT_PUBLIC_API_URL` is set correctly in the dashboard's environment configuration (e.g., `.env.local` for development or the provider dashboard for production).
   - In the browser console, check the value of the resolved API URL (inspect network tab requests). If `NEXT_PUBLIC_API_URL` is missing in production, the dynamic `AGENT_URL` resolver in [`dashboard/src/lib/agent-url.ts`](../dashboard/src/lib/agent-url.ts) returns `null` and the dashboard renders a configuration error page. In development, it defaults to `http://localhost:3004` but prints a console warning.

2. **Verify CORS Allowlist Configuration**
   - If the browser console shows CORS errors, the agent backend is not allowing cross-origin requests from the dashboard's origin.
   - The agent server uses `DASHBOARD_ORIGIN` (primary) or `ALLOWED_ORIGINS` (comma-separated list) to configure allowed CORS origins. If both are unset, it defaults to local dev URLs and configuration variables (see [`shared/cors.ts`](../shared/cors.ts)).
   - Run a `curl` preflight check to verify the response headers:
     ```bash
     curl -i -X OPTIONS \
       -H "Origin: <DASHBOARD_ORIGIN>" \
       -H "Access-Control-Request-Method: GET" \
       https://<agent-url>/agent/spending
     ```
     Ensure that `Access-Control-Allow-Origin` matches your `<DASHBOARD_ORIGIN>` and `Access-Control-Allow-Credentials: true` is present.

3. **Check `/metrics` and Health Probes**
   - Check the health check endpoint on the agent server:
     ```bash
     curl -s https://<agent-url>/health | jq .
     ```
     Look for `"ready": true`. If it returns 503 or fails to respond, the agent process itself is down or failing startup checks.
   - Query the `/metrics` endpoint to monitor HTTP errors or system resources:
     ```bash
     curl -s https://<agent-url>/metrics | grep -i http_requests
     ```
   - Check if the agent process is running:
     - Locally: Verify `npm run dev` or equivalent runner is active in your terminal.
     - Production: Check Render or Docker logs for crashes, exit codes, or unhandled exceptions.

4. **Client-Side (Poll/SSE) Diagnostics**
   - CareGuard implements dynamic Server-Sent Events (SSE) via `/agent/stream` to push state updates on change (spending, transactions, status).
   - If SSE fails (due to intermediate proxies, Cloudflare limits, or unsupported client environments), the dashboard automatically falls back to HTTP polling every 3 seconds (`fetchSpending` and `fetchTransactions`).
   - Open Browser Developer Tools → **Network Tab** → Filter by `EventSource` or `stream`. Inspect the connection state:
     - Ongoing/Pending state (200 OK with `Content-Type: text/event-stream`) indicates a healthy SSE stream.
     - Red/Failed status indicates SSE connection drops. If it is looping or failing, check if the browser environment blocks it (e.g., ad blockers, VPNs, or reverse proxy buffering).
     - Check the **Console Tab** for `[Poll] Spending/transactions poll error` to see if the fallback polling is also failing.

---

**Mitigation**

### API-down / CORS / Configuration Causes
1. **Option A (Missing/Incorrect URL Env Var)**: Update the environment variables in your deployment or `.env.local`:
   ```bash
   # In dashboard/.env.local (development)
   NEXT_PUBLIC_API_URL=http://localhost:3004
   ```
   Restart the dashboard process.
2. **Option B (CORS Domain Blocked)**: Set the `DASHBOARD_ORIGIN` env var on the agent server to allow the dashboard domain:
   ```bash
   # In agent environment configuration
   DASHBOARD_ORIGIN=https://your-dashboard-domain.com
   ```
   Restart the agent service to load the updated CORS configuration.
3. **Option C (Agent Service Down)**: If the agent API is completely down (HTTP connection refused), restart the agent process:
   - Locally: Restart the service using `npm run dev`.
   - Production: Trigger a redeployment/restart on Render or check if the container crashed due to resource limits.

### Client-Side (SSE / Polling) Causes
1. **Option A (Proxy/CDN Buffering)**: If EventSource is failing but standard requests work, the proxy (e.g. Nginx, Cloudflare) may have response buffering enabled. Disable buffering by adding the `X-Accel-Buffering: no` header in your reverse proxy config, or bypass CDN proxy rules for the `/agent/stream` path.
2. **Option B (API Key Mismatch)**: SSE streams verify the incoming API key. If the stream returns 401/403, ensure that the dashboard and agent share matching API keys in `NEXT_PUBLIC_AGENT_API_KEY` (dashboard) and `AGENT_API_KEY` (agent).
3. **Option C (Client Fallback)**: If SSE remains blocked by corporate firewalls or VPNs, verify that polling fallback is active. The dashboard automatically switches to polling when SSE disconnects. If polling is throwing errors, ensure the browser network settings are not blocking consecutive fetch calls.

---

**Remediation**

- Implement synthetic ping checks targeting `GET /health` and `GET /ready` on the agent server.
- Set up alerting in Sentry for client-side connection failures.
- Automate CORS allowlist configuration updates during deployment (e.g., dynamically populate `DASHBOARD_ORIGIN` using deployment environment hooks).

---

**Post-mortem template**

```
Date / duration:
Scope: Dashboard UI displays "Disconnected" status to caregivers
Root cause: [ AGENT_URL config mismatch | CORS block | Agent process crash | SSE proxy buffer issue ]
Detection lag: (time from first failure to incident declared)
Mitigation taken:
Remediation:
User communications sent: [ yes | no ]
Action items:
  - [ ] Add synthetic monitoring for dashboard /health check endpoint
  - [ ] Set up automated uptime alerts on Sentry for dashboard poll failures
  - [ ] Document proxy-buffering guidelines for self-hosters
```

---

**Related**

- [`dashboard/src/hooks/use-agent-state.ts`](../dashboard/src/hooks/use-agent-state.ts) — contains the polling and SSE event listeners
- [`dashboard/src/lib/agent-url.ts`](../dashboard/src/lib/agent-url.ts) — resolves the base API URL
- [`shared/cors.ts`](../shared/cors.ts) — CORS middleware config
- `agent/server.ts` — endpoint definitions for `/ready`, `/health`, and `/metrics`
