# Legacy connection retirement — 2026-10-26
Owner request: point duplicate connections to the current primary and remove duplicate routes.

## Verified current routes
GO Together HUB_V2 -> ygg-connection-hub-v2 (HubBridge).
Hub GO_APPS -> go-together (AppTools).
GitHub, Cloudflare, Notion and Google connectors use Hub V2 local providers.
Brain, Factory, Observatory and GOVIEW remain source-owned application entrypoints.
GO cloudflare_workers and cloudflare_worker calls returned HTTP 200 with destination receipts on Hub V2.
All three custom domains (apex, shop, office) point to yggmetro-web. They serve distinct entry routes; they are not duplicate connector edges.
Zone Worker routes: empty.

## Applied runtime change
prytaneion-explorer workers.dev disabled; preview URLs disabled.
Before: enabled=true, previews_enabled=false. POST acknowledged HTTP 200.
This retires the redundant legacy public entrance; it does not redirect arbitrary legacy requests or remove stored credentials/data.
No incoming service binding references this Worker in the 18-Worker inventory.
Hub localProvider handles historical provider URL aliases internally; current catalog uses only Hub V2 URLs.
Rollback: restore enabled=true, previews_enabled=false via the Worker subdomain API.

## Remaining boundaries
- Go-Together main still has PANTHEON/PANTHEON_OWNER/PRYTANEION_DIRECT, unlike runtime. PR18 is open and conflicts with main; merge requires reconciling later application changes.
- Provider PR408 remains open; this patch persists retirement in its existing branch. Main can still undo retirement until reconciled.
- greenhouse-transport METROPOLIS_SERVICE references a deleted service. None of the inspected active Workers implements all three station dispatch/readback/observatory-ingest contracts. Repointing to Hub V2 would not implement that receiver.
- LIGHT PANTHEON and PANTHEON_LIGHT have distinct entrypoints/operations and are not duplicate interchangeable bindings.
- factory-district1 and pantheon-workhub-staging are not proven duplicates merely by name. No deletion.
- Native Cloudflare plugin is independent of the custom GO Hub connector and is not removed.
