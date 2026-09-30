# GO Hub Current Governance

**Status:** CURRENT  
**Updated:** 2026-09-23  
**Scope:** GO Hub authority, routing, repository-operation governance

## Current operating contract

1. **Work ID is the durable identity of work.** A chat room or UI session may receive, continue, return, or resume the same Work ID without becoming part of the Work identity.
2. **Room ID is not required governance.** Centre, Factory, and repository-operation contracts must not require a room identifier in order to continue existing work.
3. **Checkpoint ID is the return point for a Work passage.** Return Address must match the Checkpoint ID; it is not a replacement for Work ID.
4. **GO is the primary identity; Persona is temporary working context.** Live runtime code must use the current Persona contract. Historical superseded fitting terminology is non-authoritative migration evidence only.
5. **One concern has one decision authority.** Heimdall owns Hub Evidence Gate decisions; Centre owns Work identity/state/distribution/return; Factory owns planning/production/assembly/internal QC; Counter+Notion own knowledge exchange and evidence production; Audit owns immutable history; Maintenance owns health classification only.
6. **Consumers consume authority decisions; they do not recreate them.** Counter, City routing, Maintenance, Dashboard, and other surfaces must not independently decide evidence sufficiency, lifecycle authority, or another concern already owned elsewhere.
7. **Repository mutation follows the governed GO Hub route.** Work carries its original Work ID / Checkpoint ID / Return Address and reaches the canonical destination before source changes.
8. **Routine repository edits happen on a task branch.** Historical design documents never grant permission to write directly to `main`.
9. **Change the canonical owner instead of layering a second authority.** When replacing behavior, migrate callers to the current owner, remove or quarantine obsolete competing paths after dependency proof, and preserve historical material only as explicitly non-authoritative evidence.
10. **Current runtime/code truth wins over old prose.** If a historical plan conflicts with current runtime contracts, classify the old text as historical evidence rather than merging its rules into the current contract.

## HERMES Work Tablet boundary

HERMES is the **entrance/exit desk for a Work Tablet**, not a route executor.

The operating model is intentionally like entering an amusement park:

```text
ENTRY (mandatory once)
  ├─ create_tablet
  ├─ pickup_tablet
  └─ emergency_enter
        ↓
GO moves freely inside the Work
  ├─ chooses targets/tools/order manually
  ├─ writes chosen data with update_tablet
  └─ may ask help_choose, but HERMES never selects or writes for GO
        ↓
EXIT (mandatory once)
  └─ return_tablet
```

Rules:

- The user-facing portable context is a **Work Tablet**, identified by `tabletId`.
- The Tablet carries persistent resume data chosen by GO: intent, arbitrary `data`, destinations, `tool_access`, evidence/result pointers, and `last_return`.
- `data` is GO-owned working data. HERMES must not inject unselected target/context information into it.
- `help_choose` is optional and read-only. It may rank or explain candidates, but `selectedAutomatically` must remain false.
- `update_tablet` is GO's manual write surface. It does not open a route or Pass and does not require an additional confirmation prompt.
- `create_tablet`, `pickup_tablet`, and `emergency_enter` are the only canonical entry paths. Entry establishes the active GO-held Work but does not open a Pass.
- After entry, Tablet `tool_access` is the direct tool gate. GO may change that list manually with `update_tablet` and then call the selected tools directly.
- Direct tool gating reads Centre Work truth; it must not call HERMES on every tool execution.
- Merge is an ordinary Tablet-authorized governed tool once GO puts `go_hub_merge_pull_request` in `tool_access`; exact-head CI remains mandatory, but there is no separate BIG approval stop inside the Work.
- `return_tablet` performs Work return, stores latest result/evidence on the Tablet, closes the HERMES session, and is the canonical exit.
- Centre remains current Work truth. Tablet data is portable working/resume context and must never replace fresh owner-source readback.
- Legacy Card fields/actions remain internal compatibility only during migration; they are not canonical user-facing language or flow.

## Pin identity routing

The first owner command locks the Pin identity policy for that request chain:

- **Continue / edit** → resolve and reuse the existing Pin.
- **Continue / edit + archived Pin** → reopen the same Pin before further work.
- **Continue / edit + unresolved Pin identity** → lookup/review is required; do not silently create a replacement Pin.
- **Create / start new** → create a new Pin.
- Board content stays flexible. This routing policy protects identity/history; it does not restrict what kinds of information may be pinned.

## Current code evidence

- `go-hub-authority-map.js` — canonical decision-authority map.
- `go-hub-heimdall.js` — Hub Evidence Gate decision authority and bounded Audit Sentinel event production.
- `go-hub-centre.js` / `go-hub-centre-live.mjs` — Work identity/state/distribution/return lifecycle.
- `go-hub-counter.mjs` — knowledge/evidence exchange; not Hub evidence-sufficiency authority.
- `go-hub-city-route.js` — routing consumer of authoritative decisions.
- `go-hub-maintenance.js` — health classification only.
- `go-hub-route-contract.js` — canonical destination and Work Context validation.
- `go-hub-factory-return.js` — Factory Work Context derives from Centre identity.
- `go-hub-board-pin-route.js` — sticky first-command Pin identity routing.
- `go-hub-housekeeper.js` — source-bound closeout planning; no implicit deletion.

## Historical documents and branches

Historical material may remain for auditability, but it is never a second live contract.

- Superseded plans/specs must carry an explicit historical/non-authoritative marker or live only in the historical archive.
- Closed or superseded branches/PRs must not be treated as implementation sources for new work.
- If a capability is replaced, new work should target the canonical owner/path rather than copy, append, or partially merge the old implementation.
- Deletion/retirement still requires dependency proof; until then, quarantine and label the old path instead of extending it.
