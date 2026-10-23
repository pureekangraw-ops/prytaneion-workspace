# PRYTANEION — read-only entry restored (22 Oct 2026)

## Current verification — 23 Oct 2026 (supersedes 22 Oct preflight)

**Runtime VERIFIED, scope limited to fixed read probes.** The connected
`go-together` owner-authenticated MCP reads the `prytaneion-explorer`
`HubDirectRead` named WorkerEntrypoint through its private
`PRYTANEION_DIRECT` Service Binding. A live read returned FRESH,
readOnly=true, and GitHub / Cloudflare / Notion REST / Google Drive each
CONNECTED. These four probes verify only bounded credentialed reads, not
provider-wide permissions, Notion AI Search, Factory commands, or arbitrary
file access. The legacy GO Brain `cloudflare_worker` tool's top-level
`CLOUDFLARE_NOT_CONFIGURED` is **separate** from the functioning
`hubDirectRead` status; do not share tokens simply to make that label green.

- Hub deployed Worker version:
  `2330852e-a121-4177-b254-ed309ae08710` at 100%.
  Source commit: `38d20ca5f235ea3563b24a526b7ebde733ec2b2e`.
- GO Brain caller deployed Worker version:
  `1435fbb4-b853-4a80-9a0e-6b675cdccc24` at 100%.
  Source commit: `cb10b1570cbb08a7f136e8f71f4b029516d9b926`.
- Source review: [PRYTANEION Draft PR #407](https://github.com/pureekangraw-ops/prytaneion-workspace/pull/407)
  retargeted **directly to main** so it brings the entire recovery entrance
  and direct probes together, without duplicate release PRs.
- Caller review: [Go-Together Draft PR #10](https://github.com/pureekangraw-ops/Go-Together/pull/10)
  still targets `main`, and retains existing owner OAuth, D1, assets and
  PANTHEON bindings.
- [Recovery CI run 39910962962](https://github.com/pureekangraw-ops/prytaneion-workspace/actions/runs/39910962962)
  PASS at source commit `c6f76c722551aa8e877cb1a4f190341ea14e26d6`:
  26 unit tests, 1 Miniflare Service Binding runtime test and
  **2 live public HTTP tests** all passed. GitHub-hosted runner observed
  `GET /health` and `GET /api/explore` as read-only maintenance;
  unauthenticated refresh with forged headers returned 403, POST write
  returned 405, fake public named RPC returned 404, and only redacted
  status-only snapshots were exposed. See
  `recovery/prytaneion-explorer/public-live-smoke.test.mjs`.
- [STANDARD Safety Gate run 39910962950](https://github.com/pureekangraw-ops/prytaneion-workspace/actions/runs/39910962950)
  PASS at the same source commit.
- No secret values were read, copied or modified; Hub remains
  **UNDER MAINTENANCE** and Factory work disabled.

**Important release boundary:** Both currently live Worker versions are
ahead of their repositories' `main` branches. Do **not** redeploy either
Worker from stale `main`, as that would remove the working bridge.
The legacy `.github/workflows/go-hub-deploy.yml` runs on every push to the
PRYTANEION `main` branch and targets the separate legacy `go-hub`
Worker. Merging #407 would trigger that workflow, whose safety/preflight
behavior must be reviewed independently. Keep #407 and #10 Draft and
do not merge or deploy the legacy `go-hub` merely to complete this
read-only recovery. Obtain explicit owner release approval after checking
the workflow and rollback plan.

---


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
