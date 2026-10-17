# Compatibility Matrix

This table maps each CareGuard application version to the required runtime, key SDK versions, and API contract version. Update it every time a new release is cut (see [versioning.md](./versioning.md#cutting-a-release)).

## Matrix

| App version | Node.js | `@stellar/stellar-sdk` | `@x402/express` / `@x402/fetch` / `@x402/stellar` | `@stellar/mpp` + `mppx` | `openai` | API contract version | Notes |
|-------------|---------|------------------------|-----------------------------------------------------|--------------------------|----------|---------------------|-------|
| `v1.0.0` | `>=22.0.0` | `^14.6.1` | `^2.11.0` | `^0.4.0` + `^0.6.5` | `^6.36.0` | `v1` | Initial release — Stellar testnet only |

> **How to read this table:**  
> - SDK ranges are the ranges from `package.json` at the time of that release.  
> - "API contract version" refers to the server's OpenAPI version tag (see [`docs/openapi.yml`](../openapi.yml)), which is bumped when the `/agent/run`, `/bill/audit`, or payment-service interfaces change in a breaking way.  
> - A `^` range means any compatible minor/patch within that major is known good; a pinned version means only that exact version has been validated.

## Dashboard ↔ Server Compatibility

The Next.js dashboard (`dashboard/`) calls the AI agent server (`agent/server.ts`) over HTTP. They must be deployed from the same git tag to guarantee API contract alignment.

| Dashboard version | Compatible server version |
|-------------------|--------------------------|
| `v1.0.0` | `v1.0.0` |

**Rule:** dashboard and server versions must share the same `MAJOR.MINOR`. A patch bump on the server is safe. A minor or major bump on the server requires a matching dashboard update.

## SDK-Specific Compatibility Notes

### `@stellar/stellar-sdk` (`^14.x`)

- The agent signs transactions with `Keypair.fromSecret()` and submits via `Horizon.Server` — both stable APIs across `^14.x`.
- Fee-bump retry logic in `agent/tools.ts` depends on the `FeeBumpTransaction` builder introduced in `14.0`. Do not downgrade below `14.0`.
- The `stellar-sdk` enforces a minimum fee of 100 stroops per operation. Deployments using `STELLAR_BASE_FEE_STROOP` env var below 100 will be silently clamped.

### `@x402/*` (`^2.11.x`)

- All three packages (`@x402/express`, `@x402/fetch`, `@x402/stellar`) must use the same major+minor version. Mixed versions cause the facilitator handshake to fail with a 402 signature mismatch.
- The OZ facilitator endpoint is pinned via `OZ_FACILITATOR_URL` in `.env`. A facilitator upgrade may require a corresponding `@x402/*` package bump.

### `@stellar/mpp` + `mppx`

- `@stellar/mpp ^0.4.0` and `mppx ^0.6.5` are co-dependent; they must be updated together.
- The pharmacy-payment service (`services/pharmacy-payment/server.ts`) uses the MPP Charge mode; the agent client (`agent/mpp-client.ts`) uses the corresponding fetch wrapper. Both must be on matching protocol versions.

### `openai` (`^6.x`)

- Any OpenAI-compatible provider (Groq, OpenRouter, OpenAI) works with `openai ^6.x` via the `baseURL` override in `docs/agent/llm-config.md`.
- The `tool_choice` and streaming APIs changed between `v5` and `v6`. Do not use `openai ^5.x`.

## Updating the Matrix on Each Release

1. Cut the release tag (follow [versioning.md](./versioning.md#cutting-a-release)).
2. Open `docs/release/compatibility-matrix.md`.
3. Add a new row with the new version, today's dependency versions from `package.json`, the current API contract version, and a brief note.
4. Update the Dashboard ↔ Server table if the minor or major version changed.
5. Commit the update as part of the release commit (or immediately after the tag):
   ```
   git commit -m "docs: update compatibility matrix for vX.Y.Z"
   ```

## Related

- [versioning.md](./versioning.md) — version bumping rules and release process
- [CONTRIBUTING.md — Changelog Guidelines](../../CONTRIBUTING.md#changelog-guidelines) — PR conventions
- [`package.json`](../../package.json) — canonical engine and dependency versions
- [`docs/openapi.yml`](../openapi.yml) — API contract version source
