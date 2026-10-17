# Data Storage Convention

## Overview

Runtime state written by the CareGuard agent is stored under `data/`. This directory is excluded from version control via `.gitignore`. Never commit files under `data/` to git.

## Directory Layout

```
data/
├── README.md                  # Brief usage note
├── seed.json.example          # Bootstrap template for new deployments
├── audit.log.jsonl            # Hash-chained, append-only audit log (active segment)
├── audit.log.jsonl.1..12      # Rotated archive segments (.1 newest, .12 oldest)
├── recipients/
│   └── <recipientId>/
│       ├── spending.json           # Legacy full-file (backward compat)
│       ├── transactions.jsonl      # Append-only log (one JSON line per tx)
│       ├── spending.snapshot.json  # Compacted snapshot (every 100 txs)
│       ├── policy.json             # Per-recipient spending policy
│       └── orders.json             # Order history
```

For the exact record shape, hash-chain fields, and rotation naming of
`audit.log.jsonl`, see
[`docs/data/audit-log-schema.md`](./audit-log-schema.md).

## Persistence Strategy

- **transactions.jsonl**: Append-only. Each transaction is written as a single JSON line (O(1) per call).
- **spending.snapshot.json**: Compacted full state written every 100 transactions via atomic rename.
- **spending.json**: Legacy full-file written on every save for backward compatibility with external tooling.

On startup, the agent reads the snapshot, then replays only the JSONL lines appended after the last compaction.

## Bootstrap

Copy `data/seed.json.example` to the per-recipient directory to initialize spending state:

```bash
cp data/seed.json.example data/recipients/rosa/spending.json
```

## Sensitive Data

The following files contain sensitive financial data and must never appear in git history:

| File | Contents |
|------|----------|
| `spending.json` | Live per-day spending totals and policy state |
| `orders.json` | Full transaction history including amounts and wallet addresses |
| `transactions.jsonl` | Append-only transaction log |
| `policy.json` | Spending policy configuration |

Marking these files sensitive says nothing about how long they're kept or
how a caregiver/recipient's data gets deleted. See
[`docs/data/retention.md`](./retention.md) for retention periods per data
class, the data-subject erasure procedure, and what's actually protected at
rest (this file's "sensitive" label means "kept out of git," not encrypted
on disk — `retention.md` covers that distinction in full).

## Git History Scrubbing

If sensitive data files were committed in the past, use `git filter-repo` to remove them from history:

```bash
git filter-repo --path data/spending.json --path data/orders.json --invert-paths
```

After scrubbing, force-push to all branches and notify collaborators to rebase.

## Disaster Recovery & Backups

For backup cadences, recovery targets (RTO/RPO), restore procedures, and audit log integrity verification, refer to the [Backup and Disaster Recovery Runbook](file:///Users/favoureze/careguard/docs/runbooks/backup-restore.md). For detailed JSONL record schemas, hash-chain fields, log rotation behavior, and verification algorithms, see [`docs/data/audit-log-schema.md`](./audit-log-schema.md).

