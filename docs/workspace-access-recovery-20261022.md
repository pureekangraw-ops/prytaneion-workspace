# PRYTANEION workspace access recovery (draft)

Status: discovery / read-only integration; not deployed.

## Existing entry points verified in source
- `go-hub-edge-worker.mjs`: central edge entrypoint.
- `/hub/api/github-workspace/factory-action`: existing factory action route constant.
- `/hub/api/centre`: centre API root.
- `/hub/api/factory-eye`: factory-eye API root.
- `go-hub-factory-mcp-worker.mjs`: factory MCP worker import.
- `go-hub-worker.mjs`: GitHub lifecycle worker import.

## Safe access restoration path
1. Identify current Cloudflare deployment and authenticated host; do not assume repository code is deployed.
2. Verify route availability and auth requirements via non-mutating requests.
3. Compare existing action schemas with PANTHEON queue and ATLAS contracts; reuse existing routes rather than introducing duplicate APIs.
4. Add contract tests for Intake -> Dispatch -> Execution -> Receipt and retry/idempotency.
5. Wire the minimum adapter behind existing authorization and audit gates, then run CI and open a review PR.
6. Deploy only after live environment, secrets, and owner-facing permissions have been verified.

No public unauthenticated execution route, secret, or deployment is introduced by this document.
