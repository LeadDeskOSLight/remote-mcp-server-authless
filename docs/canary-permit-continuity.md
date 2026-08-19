# Canary runtime-permit continuity

This procedure applies only to the inactive Make remediation clones and the
`remote-mcp-server-authless-canary` Worker. It must not be used to change or
activate production scenarios.

## Make mappings

Import the sanitized remediation blueprints from `artifacts/make-blueprints/`
or apply the same mappings manually:

- Gateway HTTP modules 6, 8, and 14 forward `runtimePermit` and
  `permitFingerprint` from incoming webhook module 2.
- Every Notion clone Webhook response echoes `runtimePermit` and
  `permitFingerprint` from incoming webhook module 3.
- The Calendar clone Webhook response echoes `runtimePermit` and
  `permitFingerprint` from incoming webhook module 3.
- Gateway response modules 10 and 13 return the downstream receipt. Module 15
  already returns the complete module 14 response.

Do not place either value in logs, fixed text, scenario names, notes, or test
output. Keep every remediation scenario inactive and use **Run once** only
when prompted by the regression harness.

## Enforcement

The Worker validates the signed permit before execution, sends the exact
opaque permit and its SHA-256-derived fingerprint through the canary Make
path, and requires both values to return unchanged. A missing or mismatched
receipt is rejected as `INVALID_GATEWAY_CONFIRMATION`. The Worker removes both
receipt fields before returning the capability result to the MCP client.

## Regression

After deploying only the canary Worker, run:

```powershell
node "$env:USERPROFILE\Documents\remote-mcp-server-authless\scripts\canary-runtime-lifecycle.mjs" `
  "https://remote-mcp-server-authless-canary.mohmoh-wahba.workers.dev/mcp" `
  "$env:USERPROFILE\Documents\LeadDeskCanarySecrets\LEAD_DESK_API_KEY.txt" `
  "Catherine-28-Elantra"
```

The acceptance output must include:

- `FULL_CONTEXT_MARKERS=PASS`
- `TAMPERED_PERMIT=REJECTED`
- `EXACT_PERMIT_LOOKUP=PASS`
- `MAKE_PERMIT_CONTINUITY=PASS RECEIPT_REDACTED=PASS`
- `CANARY_RUNTIME_LIFECYCLE=PASS`

The harness intentionally does not print the permit or its fingerprint.
