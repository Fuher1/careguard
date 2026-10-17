# ADR 008: Append-Only Hash-Chained Audit Log Design

**Status:** Accepted  
**Date:** 2026-07-27  
**Issues:** [#742](https://github.com/harystyleseze/careguard/issues/742)

> For the precise, field-by-field record schema, hash-chain verification
> steps, and rotation-file naming — the operator/integrator reference, as
> opposed to this ADR's design rationale — see
> [`docs/data/audit-log-schema.md`](../data/audit-log-schema.md).

---

## Context

CareGuard requires a high-integrity, tamper-evident record of all AI agent decisions and caregiver actions (such as spending policy modifications, bill audits, and payment approvals). A simple plain text or standard JSON file is vulnerable to retrospective alteration, insertion, deletion, or reordering of entries by anyone with local file-system access (e.g., a compromised application process, a malicious developer, or a compromised host). 

To detect unauthorized modifications, we need a mechanism that cryptographically chains log entries together. This ensures that any change to historical records invalidates subsequent hashes, making tampering immediately detectable.

---

## Decision

We implement a **tamper-evident hash-chained audit log** in [shared/audit-log.ts](file:///Users/favoureze/careguard/shared/audit-log.ts). 

Key design elements of the system:
1. **JSONL Format**: High-signal audit events are stored as line-delimited JSON (JSONL), allowing efficient append-only operations.
2. **Canonical Serialization**: To ensure deterministic and reproducible SHA-256 hash calculations across different platforms and runtime contexts, the payload (excluding metadata fields like `prevHash` and `hash`) is sorted alphabetically and canonicalized via a custom `canonicalize` function.
3. **Cryptographic Linkage**: Each new entry contains the cryptographic hash of the previous line, binding them sequentially.
4. **Log Rotation**: Automatic size-based rotation checks are executed before writing to prevent disk exhaustion.
5. **Offline Verification**: A command-line script validates the integrity of the entire hash chain from genesis to the current tip.

---

## Technical Details

### JSONL Record Shape

Each entry is saved as a single JSON line with the schema documented in detail in [`docs/data/audit-log-schema.md`](../data/audit-log-schema.md):

```json
{
  "timestamp": "2026-07-27T11:54:11.000Z",
  "event": "policy_updated",
  "actor": "caregiver",
  "details": {
    "dailyLimit": 200,
    "monthlyLimit": 1000
  },
  "prevHash": "f51fbc10...",
  "hash": "8a32d1ef..."
}
```

*   `timestamp`: ISO-8601 UTC date string when the log entry was created.
*   `event`: High-signal category string.
*   `actor`: Triggering entity (e.g., `"agent"`, `"caregiver"`).
*   `details`: Optional structured payload containing context specific to the event.
*   `prevHash`: Hexadecimal SHA-256 hash of the immediate predecessor.
*   `hash`: SHA-256 hash computed over `prevHash + canonicalize(payload)`.

### Chaining Scheme (prev-hash linkage)

1. **Genesis Entry**: For the very first entry (where the log file is empty or missing), `prevHash` is set to the genesis constant:
   `"0000000000000000000000000000000000000000000000000000000000000000"` (64 zeroes).
2. **Subsequent Entries**: For entry $i > 0$:
   $$\text{prevHash}_i = \text{hash}_{i-1}$$
3. **Hash Calculation**: The payload (fields `timestamp`, `event`, `actor`, `details`) is canonicalized into a deterministic string representation. The hash is calculated as:
   $$\text{hash}_i = \text{SHA256}(\text{prevHash}_i + \text{canonicalize}(\text{payload}_i))$$

Deterministic canonicalization sorts object keys alphabetically and formats primitives consistently:
*   Arrays are canonicalized element-wise: `[val1,val2,...]`
*   Objects are canonicalized as sorted keys: `{"key1":val1,"key2":val2,...}`
*   Null values become `"null"`, strings are JSON-serialized, and numbers/booleans are represented as their raw JSON values.

### Rotation Behavior

To manage local disk usage, the audit log system performs size-based rotation:
*   **Threshold**: The active log file is capped at $10 \text{ MB}$ (`MAX_FILE_SIZE = 10 * 1024 * 1024` bytes).
*   **Archives**: Up to $12$ archives are retained (`MAX_ARCHIVES = 12`).
*   **Procedure**: When the active file size meets or exceeds the threshold:
    1. The oldest archive file `audit.log.jsonl.12` is deleted if it exists.
    2. Archive files are renamed backwards: `audit.log.jsonl.i` becomes `audit.log.jsonl.i+1`.
    3. The active file `audit.log.jsonl` is renamed to `audit.log.jsonl.1`.
    4. A new blank `audit.log.jsonl` is initialized.

*Note: Since rotation breaks the physical file continuity, each rotated archive maintains its internal hash chain. However, verifying log continuity across archives requires validating the boundary link where the first line of an older file references the final hash of the next sequentially numbered archive.*

### Integrity Verification Approach

The script [scripts/verify-audit-log.ts](file:///Users/favoureze/careguard/scripts/verify-audit-log.ts) validates the chain:
1. It reads the active `audit.log.jsonl` file.
2. It loops through all records sequentially starting from index 0.
3. For each line $i$:
    *   It checks that `prevHash` matches the expected previous hash (starts at 64 zeroes, and updates to the current verified hash).
    *   It separates `prevHash` and `hash` from the other payload attributes.
    *   It computes the SHA-256 hash using the extracted payload and `prevHash`.
    *   It verifies that the computed hash equals the stored `hash`.
4. If any assertion fails, the script outputs the exact line/index of failure and exits with code `1`.

---

## Consequences

### Positive

- **Tamper Evidence**: Any modification, insertion, deletion, or reordering of entries in historical logs invalidates all subsequent hashes, triggering alerts during verification.
- **Low Overhead**: Appending logs remains highly performant as only the last line needs to be read to fetch the previous hash.
- **Determinism**: Alphabetical key sorting in canonicalization prevents hash mismatches due to object formatting variations.

### Negative / Neutral

- **File Lock Dependency**: Writers must coordinate concurrent access. The implementation relies on `proper-lockfile` synchronous directory locks to prevent race conditions during write operations.
- **Rotation Boundary Verification**: The verification script processes one file at a time; verifying the full historical timeline requires stitching rotated log files together.

---

## Residual Risks

While the design prevents naive log tampering, several security limitations persist:

1. **No External Anchoring**: Since the audit logs and their cryptographic hashes reside on the same server file system, an attacker with write access to the host (or administrative privileges) can modify historical log entries and completely recalculate the hash chain forward to make it appear valid. Anchoring the latest hash root to a public, immutable ledger (like Stellar) or an external log store would be required to prevent host-level rewriting.
2. **Truncation and Replay Detection Limits**: If an attacker truncates the end of the log file (removing the most recent $N$ entries), the remaining hash chain remains mathematically valid. Verification alone cannot detect that lines are missing from the tail unless a secondary length assertion or external checkpointing is in place.
3. **Single-Writer Assumption**: The locking mechanism (`proper-lockfileSync`) is cooperative. If another utility or user writes to `audit.log.jsonl` bypassing this module, the formatting or sequence could be broken, causing verification failures or corrupt data.
