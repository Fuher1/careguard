# Runbook: Grafana Dashboard Backup and Recovery

> **Known pre-existing issue, verified while writing this runbook — read
> this first.** `docker/grafana/provisioning/dashboards/careguard.yml`
> currently declares `path` as a **top-level** field under the provider
> entry. Grafana 11.3 (the version this repo pins in `docker-compose.yml`)
> requires `path` **nested under an `options:` key** for the file
> provisioner — this isn't a style preference, it's the documented schema.
> Confirmed empirically, not just from Grafana's docs: running the actual
> `grafana/grafana:11.3.0` binary against this repo's real, unmodified
> provisioning files with `path` at the top level fails to start at all
> (`Failed to initialize file readers: ... failed to load dashboards, path
> param is not a string`); moving the exact same line under `options:` and
> nothing else fixed it, and the same real, unmodified `careguard.json`,
> `agent.json`, and `payments.json` then provisioned correctly. **This means
> every procedure below assumes a working Grafana container, but the
> `grafana` service as currently configured will not start at all** — this
> is a pre-existing bug, unrelated to and not fixed by issue #751 (a
> documentation issue, not a code one; `docker/grafana/provisioning/` isn't
> one of the files this issue's `Relevant Files` names), but it blocks every
> step in this runbook until corrected. The fix is:
> ```diff
>      allowUiUpdates: true
> -    path: /etc/grafana/provisioning/dashboards
> +    options:
> +      path: /etc/grafana/provisioning/dashboards
> ```

**Symptom**

Either of:
- A Grafana dashboard customization made in the UI (a panel edit, a new
  ad-hoc dashboard, a changed threshold) is missing after `docker compose
  down -v`, a Grafana container restart, or a fresh clone/boot on another
  host.
- You're about to run `docker compose down -v` (or otherwise expect to lose
  the `grafana-data` volume) and want to make sure nothing UI-only is lost
  first.

**Impact**

Observability only — no application data, spending records, or the audit
log are affected. Whoever relies on the Grafana dashboards
(`http://localhost:3030` locally, per `docker-compose.yml`) loses that
visualization until it's restored. Severity is low if the missing state was
only ever provisioned JSON already in git (that comes back automatically —
see Mitigation), and higher if it was a UI-only edit or ad-hoc dashboard
that was never exported.

**Diagnosis**

0. First, confirm Grafana actually started: `docker compose ps grafana` /
   `docker compose logs grafana`. If it's not healthy or exited, see the
   known-issue callout at the top of this doc before anything below — a
   provisioning config error is fatal to Grafana's startup, not a "some
   dashboards missing" partial failure.
1. Confirm what's actually missing. `docker/grafana/dashboards/` has three
   provisioned dashboards today: `careguard.json` (uid `careguard-overview`),
   `agent.json` (uid `careguard-agent`), `payments.json` (uid
   `careguard-payments`) — documented per-panel in
   [`docs/observability/dashboard-guide.md`](../observability/dashboard-guide.md).
   If one of these three is gone from the Grafana UI, that's a provisioning
   problem (see Mitigation), not a data-loss problem — the file is still in
   git.
2. If a dashboard *not* in that list of three is missing, or a panel edit to
   one of the three is missing, that state only ever existed in Grafana's
   own internal database — the named Docker volume `grafana-data`, mounted
   at `/var/lib/grafana` in the `grafana` service
   (`docker-compose.yml`) — and was lost when that volume was removed.
3. Check whether the volume still exists at all: `docker volume ls | grep
   careguard_grafana-data` (or `<project>_grafana-data` — the exact name is
   prefixed with the Compose project name). If it's gone, `down -v` (or an
   equivalent manual `docker volume rm`) is almost certainly why.

**Mitigation**

(Assumes the provisioning config actually parses — see the known-issue
callout at the top if `docker compose ps grafana` shows it unhealthy or
exited.) For provisioned dashboards (the three JSON files above) and the
Prometheus datasource — the fast path is doing nothing extra: run `docker
compose up
-d grafana`. Grafana re-reads `docker/grafana/provisioning/` and
`docker/grafana/dashboards/` on every boot (both are bind-mounted read-only
— see `docker-compose.yml`), so anything defined in those git-tracked files
reappears automatically within the provider's `updateIntervalSeconds: 10`
(`docker/grafana/provisioning/dashboards/careguard.yml`). No manual restore
action is needed for these — this is the same reasoning
[`docs/observability/prometheus-retention.md`](../observability/prometheus-retention.md)
already gives for why "dashboards survive volume loss" while Prometheus's
raw metrics don't.

There is nothing to mitigate for a UI-only edit or ad-hoc dashboard that
was never exported before the volume was lost — see Remediation for how to
prevent this going forward, and Diagnosis above for confirming that's what
happened.

**Remediation**

### What `docker compose down -v` actually drops

`grafana-data:/var/lib/grafana` is a named Docker volume — Grafana's own
SQLite database, where it stores everything not defined by a provisioning
file:

- Any dashboard created directly in the Grafana UI (never saved as a file
  under `docker/grafana/dashboards/`).
- Any UI edit to a *provisioned* dashboard. `allowUiUpdates: true`
  (`docker/grafana/provisioning/dashboards/careguard.yml`) lets you edit and
  save a provisioned dashboard in the UI, but the save target is this
  database, not the read-only provisioning file
  (`./docker/grafana/dashboards:/etc/grafana/provisioning/dashboards:ro` in
  `docker-compose.yml`) — Grafana's own provisioning docs are explicit that
  the file "always" wins back over the database copy the next time
  provisioning re-reads it, "even if" the database version's number is
  higher, so an unexported UI edit is lost even *without* a volume wipe, the
  next time the file changes or Grafana restarts.
- Any admin password changed through the UI after first boot.
  `GF_SECURITY_ADMIN_USER`/`GF_SECURITY_ADMIN_PASSWORD`
  (`docker-compose.yml`) only set the admin account **once**, on first
  startup when Grafana creates it in the (until-then-empty) database — they
  don't reset an existing account. Losing the volume just means Grafana
  re-initializes the admin user from those env vars again on the next first
  boot, which is a mild convenience change, not a security concern, but is
  worth knowing so it isn't mistaken for something more serious.

`prometheus-data` and the app's own persistence (`data/`) are separate
volumes/directories and are not affected by anything in this runbook — see
[`docs/observability/prometheus-retention.md`](../observability/prometheus-retention.md)
and [`docs/data/storage.md`](../data/storage.md) respectively.

### Exporting a dashboard back into `docker/grafana/dashboards/`

This is the actual fix for the loss described above: anything you want to
survive a volume wipe has to become a provisioned file, checked into git —
Grafana's database is not a durable store for this project.

**Via the UI** (simplest for a one-off dashboard): open the dashboard →
**Dashboard settings** → **JSON Model** → **Copy to Clipboard** — this has
been the stable way to get a dashboard's full JSON across Grafana's 9–11.x
releases (this repo pins `grafana/grafana:11.3.0` in `docker-compose.yml`).
Paste the result into `docker/grafana/dashboards/<name>.json`.

**Via the HTTP API** (scriptable, useful for backing up more than one
dashboard at once): Basic Auth against the admin credentials already set in
`docker-compose.yml` is enabled by default and works with this exact setup:

```bash
# List every dashboard (uid, title) currently in Grafana:
curl -s http://admin:admin@localhost:3030/api/search | jq '.[] | {uid, title}'

# Fetch one dashboard's full JSON by uid (nested under .dashboard in the response):
curl -s http://admin:admin@localhost:3030/api/dashboards/uid/<uid> | jq '.dashboard' \
  > docker/grafana/dashboards/<name>.json
```

Before committing the exported file, match the convention the three
existing dashboards already use — checked directly against
`docker/grafana/dashboards/careguard.json`, `agent.json`, and
`payments.json`:

- Set `"id": null` — a real numeric `id` is instance-specific and Grafana's
  own UI export flow strips it for exactly this reason (to make the JSON
  provisioning-safe); the three existing files all have `"id": null`.
- Keep `"uid"` as a stable, human-readable string (`careguard-overview`,
  `careguard-agent`, `careguard-payments`) rather than the random ID Grafana
  may have assigned to an ad-hoc dashboard — pick a matching `careguard-*`
  uid if this is a new dashboard, so it's recognisable alongside the other
  three.
- `"version"` can stay whatever the export produced — per Grafana's own
  provisioning behavior described above, the file's content wins regardless
  of the version number, so this field doesn't need manual bumping.

Then either restart Grafana or wait 10s for `updateIntervalSeconds` to pick
up the new file, and confirm the dashboard now loads with the `careguard`
provider (visible in **Dashboard settings** as read-only-by-file — this is
expected and correct).

### Restoring provisioning after a fresh boot

Datasources (`docker/grafana/provisioning/datasources/prometheus.yml`) and
dashboard provisioning config
(`docker/grafana/provisioning/dashboards/careguard.yml`) are both under the
same read-only bind mount as the dashboard JSON
(`./docker/grafana/provisioning:/etc/grafana/provisioning:ro`) — since both
are git-tracked, `docker compose up -d grafana` on a completely fresh clone
(no prior volume at all) provisions the Prometheus datasource and all three
dashboards with no manual step. Verify with:

```bash
docker compose up -d grafana
curl -s http://admin:admin@localhost:3030/api/health   # {"database":"ok", ...}
curl -s http://admin:admin@localhost:3030/api/datasources | jq '.[].name'   # "Prometheus"
curl -s http://admin:admin@localhost:3030/api/search | jq '.[].uid'          # the 3 careguard-* uids
```

If a datasource or dashboard is missing after this, the fault is in the
YAML/JSON itself (a syntax error Grafana silently skipped) rather than
anything volume-related — check `docker compose logs grafana` for a
provisioning error.

**Post-mortem template**
- Date / duration:
- Root cause:
- Detection lag:
- Mitigation taken:
- Remediation:
- Action items:

---

## Related

- [`docs/observability/dashboard-guide.md`](../observability/dashboard-guide.md) — what each dashboard/panel shows, and the provisioning model
- [`docs/observability/prometheus-retention.md`](../observability/prometheus-retention.md) — the same volume-loss question for Prometheus's own data, which this runbook's Mitigation section builds on
- [`docs/data/storage.md`](../data/storage.md) — app-level persistence (unaffected by anything here)
- `docker-compose.yml` — the `grafana` service definition this runbook describes
