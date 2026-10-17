# Runbook: Backup and Disaster Recovery

This runbook outlines the backup cadences, recovery targets (RTO/RPO), and step-by-step restore procedures for CareGuard's file-backed stores, Redis database, and Grafana monitoring state.

---

**Symptom**
- On-call alert reporting loss of client data, disk corruption, database unavailability, or total host VM failure.
- Caregiver dashboard shows persistent connection errors, or displays empty/stale transaction lists.
- Server logs report missing files in the `data/` directory or failure to write to the audit log.

**Impact**
- **Severity**: Critical.
- **Affected Parties**: Caregivers cannot monitor patient transactions, change spending limits, or approve pending orders. LLM agents cannot read or record new care recipient transaction logs.
- **Disaster Recovery (DR) Targets**:
  | Data Source | Target RTO (Max Downtime) | Target RPO (Max Data Loss) |
  | :--- | :--- | :--- |
  | **Audit Log (`audit.log.jsonl`)** | 1 Hour | **0 (Zero Data Loss)** |
  | **Recipient Data (`spending.json`, `policy.json`, etc.)** | 2 Hours | 1 Hour |
  | **Redis Session & Queue Data** | 2 Hours | 1 Hour |
  | **Grafana Monitoring State** | 4 Hours | 24 Hours |

**Diagnosis**
1. Check if the filesystem directory `data/` is present and accessible:
   ```bash
   ls -la /Users/favoureze/careguard/data
   ```
2. Verify if the Docker containers are running:
   ```bash
   docker compose ps
   ```
3. Check Redis connection status and log output:
   ```bash
   docker compose logs redis
   ```
4. Query the server logs to identify read/write errors:
   ```bash
   docker compose logs server
   ```

**Mitigation**
1. **Enable Read-Only Mode / Maintenance Page**:
   If the local data store is corrupted or unavailable, route traffic to a static maintenance page to prevent users from performing new configurations.
2. **Fail Safe (Halt Agent Execution)**:
   The agent server automatically pauses and fails-closed if the file system is read-only or database writes fail, preventing inconsistent on-chain transactions without local records.

**Remediation**

### 1. Backup Sources and Cadences

We back up the following resources:
- **File-backed Stores (Agent & Audit Logs)**:
  - **Paths**: `/Users/favoureze/careguard/data`
  - **Cadence**: Hourly incremental snapshot.
  - **Mechanism**: Encrypted `tar` snapshot uploaded to AWS S3 (or equivalent WORM-enabled secure object storage) with versioning enabled.
  - **Zero RPO Strategy for Audit Log**:
    Because `audit.log.jsonl` requires **Zero RPO**, all log entries are streamed in real-time to a secure, write-only central syslog/cloud logging service. If local storage fails, the remote syslog stream is used to restore the latest tail entries that were generated since the hourly S3 backup.
- **Redis Data**:
  - **Path**: Docker volume `redis-data` (inside container: `/data`)
  - **Cadence**: Continuous AOF (Append Only File) writing with hourly snapshot archiving of the AOF directory.
  - **Mechanism**: Backup of `/data/appendonlydir` or `dump.rdb` to remote storage.
- **Grafana State**:
  - **Path**: Docker volume `grafana-data` (inside container: `/var/lib/grafana`)
  - **Cadence**: Daily snapshot.
  - **Mechanism**: Tarball backup of the SQLite database `grafana.db` to remote storage.

---

### 2. Step-by-Step Restore Procedures

#### Step A: Stop the Application Stack
To ensure data consistency, stop the server, redis, and grafana services:
```bash
docker compose stop server redis grafana
```

#### Step B: Restore the File-Backed Store (`data/`)
1. Download the latest trusted data archive from remote secure storage.
2. Remove any corrupted data files:
   ```bash
   rm -rf /Users/favoureze/careguard/data/*
   ```
3. Extract the clean backup files:
   ```bash
   tar -xzf careguard-data-backup-latest.tar.gz -C /Users/favoureze/careguard/
   ```
4. If there are missing tail logs for the cryptographic audit log (`audit.log.jsonl`) since the last hourly snapshot, fetch the tail entries from the secure remote logging provider and append them to the local `data/audit.log.jsonl` file.

#### Step C: Restore the Redis Volume
1. Use a temporary container to extract the backup files directly into the Docker volume `redis-data` (ensuring correct ownership):
   ```bash
   docker run --rm -v redis-data:/data -v $(pwd):/backup alpine sh -c "rm -rf /data/* && tar -xzf /backup/redis-backup-latest.tar.gz -C /data"
   ```

#### Step D: Restore the Grafana Volume
1. Use a temporary container to restore `grafana.db` and settings into the Docker volume `grafana-data`, and apply correct ownership (`472` is the standard user ID for the grafana user):
   ```bash
   docker run --rm -v grafana-data:/var/lib/grafana -v $(pwd):/backup alpine sh -c "rm -rf /var/lib/grafana/* && tar -xzf /backup/grafana-backup-latest.tar.gz -C /var/lib/grafana && chown -R 472:472 /var/lib/grafana"
   ```

#### Step E: Start the Stack
1. Restart the services:
   ```bash
   docker compose start redis grafana
   docker compose start server
   ```

---

### 3. Integrity Verification for Restored Audit Log

To verify that the restored database and logs have not been tampered with or corrupted:
1. **Run the cryptographic verification script**:
   ```bash
   npx tsx scripts/verify-audit-log.ts
   ```
   Confirm that the output reads:
   `Audit log successfully verified. Total entries: <Count>`

2. **Cross-reference transactions with the Stellar Blockchain**:
   - Extract transaction hashes from `data/recipients/<recipientId>/transactions.jsonl` or the restored `data/audit.log.jsonl`.
   - Query the Stellar Horizon API (e.g. `GET https://horizon-testnet.stellar.org/transactions/<stellarTxHash>`) to match the on-chain ledger with the restored local database state.
   - For example:
     ```bash
     curl -s "https://horizon-testnet.stellar.org/transactions/8f94d930db80387431e3d04cd4d673bc23010b95bf0a7019808db3bfebff2836"
     ```
   - Verify that:
     - The transaction hash exists on Stellar.
     - The amount, asset, source account, and destination account align perfectly.
     - The transaction status matches the local log.

---

**Post-mortem template**
- Date / duration:
- Root cause:
- Detection lag:
- Mitigation taken:
- Remediation:
- Action items:
