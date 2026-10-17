# CareGuard API Error Response Schema

This document defines the stable schema contract for all JSON error responses returned by CareGuard services (agent, pharmacy, bill audit, drug interactions, payments).

## The Error Envelope

Every API error response is formatted as a single JSON object containing standard properties. This contract allows frontends, client SDKs, and external consumers to handle errors consistently.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `error` | `string` | **Yes** | A user-friendly, descriptive message outlining what went wrong and how it can be mitigated. |
| `code` | `string` | **Yes** | A stable, machine-readable alphanumeric code (uppercase `SNAKE_CASE`) representing the specific error type. |
| `details` | `object` | No | Additional structured context specific to the error code. For validation failures, this property contains field-level issues. |

---

## Validation Error Structure

For validation errors (HTTP 400 with code `VALIDATION_ERROR`), the `details` field is structured to provide clear, actionable feedback on input parameters.

The `details` object contains a `fields` mapping where:
- Keys are strings representing the JSON path or parameter name (e.g. `lineItems.0.quantity`).
- Values are arrays of strings containing the specific constraint violations (e.g., `["quantity must be positive"]`).

---

## HTTP Status Contract

### Envelope Contract (Standard API Errors)
The following HTTP status codes are guaranteed to carry the standardized `{ error, code, details }` JSON envelope when returned by CareGuard microservices:
- **`400 Bad Request`**: Validation errors, malformed payloads, or invalid parameters.
- **`402 Payment Required`**: The request requires a Stellar x402 or MPP payment challenge.
- **`403 Forbidden`**: CSRF token mismatches, key restrictions, or unauthorized admin requests.
- **`404 Not Found`**: Non-existent drugs, recipients, orders, or routes.
- **`409 Conflict`**: Operations violating active state constraints (e.g., trying to run tasks while the agent is paused).
- **`429 Too Many Requests`**: Rate limits exceeded.
- **`500 Internal Server Error`**: Unexpected database or service exceptions.
- **`503 Service Unavailable`**: Degradation of required external dependencies (e.g., Horizon network down, OZ Facilitator unreachable).

### Raw Responses Contract (Exceptions)
Clients should anticipate raw (non-envelope) responses in the following infrastructure and transport scenarios:
1. **Infrastructure/Proxy Errors**: A `502 Bad Gateway`, `504 Gateway Timeout`, or `503 Service Unavailable` generated directly by a load balancer, reverse proxy (Nginx, Render routing layer), or Cloudflare. These return raw HTML or text.
2. **Payload Size Limits**: If a request exceeds server body size limits (HTTP `413 Payload Too Large`), Express's `body-parser` layer returns a raw error structure (e.g., `{ error: "Request body too large", limit: "..." }`) before reaching application routing.
3. **Health & Readiness Probes**: Endpoint `/health` and `/ready` return simple text status (`"OK"`) or custom JSON objects representing liveness checks (`ReadinessResponse`), not error envelopes.

---

## Example Payloads

### 1. Validation Error (400 Bad Request)
Returned when payload validation fails against schemas (e.g., Zod).

```json
{
  "error": "Request validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "fields": {
      "lineItems.0.quantity": [
        "quantity must be positive"
      ],
      "lineItems.0.chargedAmount": [
        "chargedAmount must be positive"
      ]
    }
  }
}
```

### 2. Payment Required Challenge (402 Payment Required)
Returned for paid query or transaction routes that implement the x402 payment protocol.

> [!NOTE]
> Standard x402 middleware implementations (such as `@x402/express` used in this codebase) respond with an empty body (`{}`) and instead transmit the base64-encoded payment requirements via the `Payment-Required` HTTP response header. The JSON structure shown below represents the parsed representation of that header metadata used by client libraries and SDKs.

```json
{
  "error": "Payment required via x402 protocol",
  "code": "PAYMENT_REQUIRED",
  "details": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "payTo": "GBV5W3XYZABC1234567890FGHIJKLMNOPQRSTUVW123",
    "price": "0.0100000",
    "asset": "USDC"
  }
}
```

### 3. Policy Block (403 Forbidden or 409 Conflict)
Returned when an agent task or manual expenditure violates a budget rule or limit configured in the recipient's spending policy.

```json
{
  "error": "Transaction exceeds monthly medication budget limit",
  "code": "POLICY_BLOCKED",
  "details": {
    "rule": "medicationMonthlyBudget",
    "limit": 300.00,
    "currentUsage": 290.00,
    "requestedAmount": 20.00,
    "recipient": "Rosa Garcia"
  }
}
```
