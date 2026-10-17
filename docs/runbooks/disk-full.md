# Runbook: Disk full / data directory exhaustion

**Symptom**

One or more of:

- The pharmacy-payment service's `GET /ready` returns `503` with
  `{ "error": "Order store is not writable" }` (`services/pharmacy-payment/server.ts`
  checks `accessSync(DATA_DIR, fs.constants.W_OK)` on every readiness probe).
- `audit-log: failed to write entry: ENOSPC: no space left on device` on stderr
  from `appendAuditEntry` (`shared/audit-log.ts`) — the catch block writes this
  directly to `process.stderr` rather than throwing, so the request that
  triggered the audit write still completes, but the entry is lost.
- `audit-log: failed to rotate logs: ...` on stderr — rotation failed, usually
  because there wasn't room to write the renamed archive.
- Any write to `data/recipients/{id}/spending.json`, `orders.json`, or
  `data/mpp-store.json` throws `ENOSPC` and the request fails with a 500.
- `docker compose` or the host reports the volume/filesystem at 100%.

**Impact**

Files under `data/` are written with plain `readFileSync`/`writeFileSync` (not
atomic rename-then-swap) in most call sites, and disk space is not
pre-checked before a write is attempted. On a full disk:

| File | What breaks |
|---|---|
| `data/audit.log.jsonl` | Appends fail (`ENOSPC`). Because the hash chain (`shared/audit-log.ts`) is computed from `prevHash + canonicalize(payload)` at write time and only advances on a successful append, a failed append simply drops the event — it does **not** corrupt the existing chain. But the event is unrecoverably lost unless it's re-derivable from another source (e.g. re-run the action). |
| `data/recipients/{id}/spending.json`, `orders.json`, `policy.json` | A write that fails partway through **can** leave a truncated/invalid JSON file, since these are not written via atomic temp-file-then-rename. The next read (`JSON.parse`) throws, and that recipient's spending/policy state becomes unreadable until fixed. |
| `data/mpp-store.json` (pharmacy-payment service) | Same non-atomic-write risk; `GET /ready` on that service will report `503` as soon as the directory itself fails a writability check, which is the earliest and most reliable signal. |
| `data/adherence.jsonl` | Appends fail; individual adherence entries are lost, same as the audit log but without a hash chain to protect. |

The audit log's rotation (`rotateLogs()` in `shared/audit-log.ts`) renames
`audit.log.jsonl` → `audit.log.jsonl.1` → ... → `.12` once the active file
reaches **10 MB**, keeping at most 12 archived generations (~120 MB total for
the audit log alone, unbounded for the other files below). Rotation itself
needs free space for the rename; on a sufficiently full disk even rotation
can fail, at which point the active file keeps growing past 10 MB.

**Files that grow unbounded** (no automatic rotation or size cap):

- `data/recipients/*/transactions.jsonl` — append-only, one line per transaction, never rotated
- `data/recipients/*/orders.json` — full order history held as one JSON array
- `data/adherence.jsonl` — append-only, never rotated
- Docker/application logs outside `data/`, if not managed by the host's log rotation

**Diagnosis**

1. **Check overall disk usage:**
   ```bash
   df -h
   ```
   For the Docker Compose deployment specifically, check the volume backing `data/`:
   ```bash
   docker compose exec server df -h /app/data   # path may differ; see docker-compose.yml volume mount
   ```

2. **Identify the largest writers under `data/`:**
   ```bash
   du -sh data/* data/recipients/*/* 2>/dev/null | sort -rh | head -20
   ```

3. **Check audit log size and rotation state specifically:**
   ```bash
   ls -lh data/audit.log.jsonl data/audit.log.jsonl.* 2>/dev/null
   ```
   If `audit.log.jsonl` is significantly larger than 10 MB, rotation is not
   keeping up — check for the `failed to rotate logs` stderr line.

4. **Check service health/readiness for the earliest signal:**
   ```bash
   curl -s localhost:3000/ready | jq .          # main server
   curl -s localhost:<pharmacy-payment-port>/ready  # pharmacy-payment service — checks DATA_DIR writability directly
   ```

5. **Grep logs for write failures:**
   ```bash
   docker compose logs | grep -E "ENOSPC|failed to write entry|failed to rotate logs|Order store is not writable"
   ```

**Mitigation (fastest way to reduce impact — not a permanent fix)**

1. **Free space immediately** by removing or moving old rotated audit archives
   first — they're the safest thing to relocate since they're already
   closed/immutable:
   ```bash
   # Move (don't delete) old archives off the full volume to preserve them
   mkdir -p /var/backups/careguard-audit
   mv data/audit.log.jsonl.[5-9] data/audit.log.jsonl.1[0-2] /var/backups/careguard-audit/ 2>/dev/null
   ```
   Do **not** truncate or delete `data/audit.log.jsonl` itself (the active
   file) — see Remediation below for why that breaks the hash chain.

2. If still critically low on space and no archives remain to move, compress
   the archives in place rather than deleting them:
   ```bash
   gzip data/audit.log.jsonl.[1-9] data/audit.log.jsonl.1[0-2] 2>/dev/null
   ```

3. Once the writability check passes again (`GET /ready` on pharmacy-payment
   returns `200`), traffic recovers automatically — there is no explicit
   "resume" step; the next write attempt just succeeds.

**Remediation (permanent fix, preserving the audit chain)**

1. **Never truncate or edit the active `audit.log.jsonl` in place.** Every
   entry's `hash` is `sha256(prevHash + canonicalize(payload))`, chained to the
   entry before it (see `appendAuditEntry` in `shared/audit-log.ts` and the
   [audit-log-tamper-detected](audit-log-tamper-detected.md) runbook). Deleting
   or rewriting lines breaks the chain the same way tampering would, and the
   verifier (`npx tsx scripts/verify-audit-log.ts`) will flag it identically —
   there's no way to distinguish "operator truncated for space" from
   "attacker tampered" after the fact. If space must be reclaimed from the
   active file, force a rotation instead (stop the service, rename
   `audit.log.jsonl` to `audit.log.jsonl.1` — shifting existing numbered
   archives up first — then restart so a fresh file with a genesis `prevHash`
   is created).
2. **Relocate `data/` to a volume with headroom.** Set `DATA_DIR` (read by
   `shared/audit-log.ts`, `shared/adherence.ts`, and
   `services/pharmacy-payment/server.ts`) to a path on a larger disk or a
   dedicated volume, then restart.
3. **Back up rotated archives off-box on a schedule**, then it's safe to
   delete local copies once confirmed backed up. There is currently no
   automated backup process for `data/` in this repo (the same gap noted for
   Prometheus data in
   [prometheus-retention.md](../observability/prometheus-retention.md)) —
   until one exists, treat step 1's "move, don't delete" archives as your
   only backup.
4. **Add alerting before the disk fills**, rather than discovering it via a
   503: alert on `df` usage percentage for the `data/` volume, and/or on the
   audit log growing past its 10 MB rotation threshold without a
   corresponding `.1` archive appearing (a sign rotation itself is failing).
5. **Bound the currently-unbounded files.** `transactions.jsonl` and
   `adherence.jsonl` have no rotation today; if this becomes a recurring
   issue, apply the same rotation strategy already implemented for the audit
   log (`rotateLogs()` in `shared/audit-log.ts`) to these files.
6. **Verify the audit chain after any recovery involving the audit log:**
   ```bash
   npx tsx scripts/verify-audit-log.ts
   ```

**Post-mortem template**

- Date / duration:
- Root cause:
- Detection lag:
- Mitigation taken:
- Remediation:
- Action items:

## Related

- `shared/audit-log.ts` — rotation threshold (10 MB), archive count (12), hash chain, non-throwing write failures
- `services/pharmacy-payment/server.ts` — `GET /ready` writability check, `MAX_BODY_SIZE`/413 handling
- [audit-log-tamper-detected.md](audit-log-tamper-detected.md) — hash-chain verification and restore process; the same chain-integrity concerns apply to any operator action that edits the active log file
- [prometheus-retention.md](../observability/prometheus-retention.md) — the same "no backup process today" gap, documented for a different data store
- `docs/adr/002-pii-in-persistence.md` — why `data/` files are untracked JSON/JSONL rather than a database, and the planned SQLite migration (#111) that would remove most of this class of failure
