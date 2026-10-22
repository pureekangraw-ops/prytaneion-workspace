# PRYTANEION — read-only entry restored (22 Oct 2026)

The owner authorized an exploration entrance only. No work queue, task
dispatch, Factory operation, secrets transfer, or replacement gateway.

## Cloudflare deployment evidence
- New isolated Worker: `prytaneion-explorer`
- Cloudflare deployment: `1de3b02d-de32-4c03-a07b-cc7ee2567be9`
- Worker version: `1ab8b9e1-6dde-4ac3-b26a-fe56481df1e3` (100%)
- Worker subdomain: `https://prytaneion-explorer.pureekangraw.workers.dev/`
- Cloudflare Service Binding: `PANTHEON_OWNER` -> `phatheon-workhub` / named `OwnerBridge` entrypoint
- `factory-district` remains bound to PANTHEON as `FACTORY`; not modified.

## Existing legacy source actually imported
`go-hub-route-contract.js` and `go-hub-authority-map.js` drive the
explorer routes and authority ownership, using original GO Hub code.
The complete legacy GO Hub is NOT deployed/restored.

## Exposed read-only routes
- `GET /`: Under Maintenance entrance
- `GET /health`: isolated explorer health
- `GET /api/explore`: source-backed legacy route/authority catalog
- `GET /api/bridge-health`: bounded RPC with fixed `factory_health`
  operation via PANTHEON; returns only connected / not connected summary.
- Everything else returns 404; non-GET returns 405.
- No arbitrary operations, tokens, secret values or task IDs exposed.

## Test evidence and gaps
- Cloudflare upload returned 200; script Settings readback confirms binding.
- Subdomain enabled via API; a deployment with 100% version allocation exists.
- GitHub unit tests are in `recovery/prytaneion-explorer/worker.test.mjs`
  and CI workflow `.github/workflows/prytaneion-recovery-tests.yml`.
- Direct public HTTP check was unavailable from the current execution
  environment. **HTTP page/bridge behavior is not yet live-verified**.
- PANTHEON OwnerBridge code is present in its repository; actual RPC response
  from the deployed explorer has not yet been observed.
- GO Hub stateful stores and legacy auth/Google/GitHub providers remain
  intentionally offline pending read-only mapping.

## Exit criterion for this phase
Verify `/`, `/api/explore`, and `/api/bridge-health` over actual HTTP.
Only then label the walking entrance tested. Do not claim Factory acceptance,
full legacy system restoration, or restart production workflows.

## Rollback
Disable `prytaneion-explorer` workers.dev subdomain. PANTHEON and Factory
bindings are untouched. Never remove the existing PANTHEON `FACTORY` binding.
