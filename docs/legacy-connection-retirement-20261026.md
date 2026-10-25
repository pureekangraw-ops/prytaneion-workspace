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

## Expanded read-only survey — 2026-10-26 Asia/Bangkok
Scope: all 18 Workers in this account; runtime service bindings and named entrypoints; workers.dev/preview entrances; Worker Builds triggers; 1 zone, its 3 custom domains, DNS and Worker routes; 1 Pages project; 2 queues; all Worker cron schedules; routing/deployment configurations in 9 GitHub repositories and HubStation on GitLab. This is a routing/configuration survey, not a live end-to-end test of every application or proof of all external callers.

Inventory:
- 12 service-binding edges: 11 target existing Workers; 1 points to a deleted service.
- No exact duplicate tuple (caller, target, entrypoint) among these 12 edges.
- No missing named entrypoint among existing service targets.
- 14 enabled workers.dev entrances, 6 enabled preview entrances. Preview presence alone does not prove duplication or an auth bypass.
- 3 custom domains -> yggmetro-web; no zone Worker routes.
- 8 Cloudflare Builds triggers on 7 Workers. GO has two branch-disjoint triggers (main vs non-main), not two identical triggers.
- PIXIE queue producer/consumer -> greenhouse-transport; its dead-letter queue is referenced by the consumer and is not orphaned.
- Only configured cron: greenhouse-transport, */2 * * * *.
- Factory source repo label Factory-District- in Cloudflare is stale display metadata: repo ID 1405687194 matches canonical Factory-District. Do not count it as a second source repository.

Nine confirmed configuration findings (one already retired, eight unresolved):
1. prytaneion-explorer redundant public entrance: disabled earlier; post-change Hub provider reads continued to work. Source patch PR408 tests passed at aa8467791461e268b30c334e8833f8e0cb8f855d (Recovery40245349568 and Safety40245349595).
2. Go-Together main wrangler.jsonc: legacy PANTHEON, PANTHEON_OWNER and PRYTANEION_DIRECT remain, while runtime uses HUB_V2 and GOVIEW_GO. Main has worker/index.js while runtime enters hub-entry. Main Cloudflare Builds trigger still deploys this main source. Current integrated PR23 config has the correct four application/Hub bindings; not merged.
3. prytaneion-workspace main recovery config: workers_dev=true plus three retired bindings (PANTHEON_OWNER, PANTHEON_LIGHT, LIGHT_LEGACY). Runtime has none and public entrance is off. PR408 holds the correction, main does not.
4. prytaneion-workspace GO Hub Deploy workflow still targets absent go-hub; its legacy config also references absent ergasterion-factory and olympus. Main push trigger remains configured (with paths-ignore), plus manual dispatch. Existing preflights may fail before deploy; no claim that it has recreated a Worker.
5. greenhouse-transport METROPOLIS_SERVICE has service_deleted=true. Source still declares metropolis, which is absent. Queue consumption and every-two-minute cron are still configured on this sender; do not count these as independent root causes. Missing receiver contract remains unresolved.
6. LIGHT normal light_cloudflare_worker path requires LIGHT_CF_READ_TOKEN and LIGHT_CF_ACCOUNT_ID, neither bound in runtime; runtime instead has CLOUDFARE_TOKEN and CLOUDFAIR_ID. Only LegacyExplorerRead cloudflare probe normalizes these aliases. Direct tool path and legacy probe therefore have different configuration behavior. Source-level finding, no token values read and no direct LIGHT tool invocation in this survey.
7. pantheon-workhub-staging public entrance remains enabled although source requires WORKHUB_TOKEN and DB and runtime has neither. Protected task paths cannot satisfy these checks. Health is not readiness proof.
8. HubStation main contains README only; deployed Hub code/config exists on go/hub-local-providers-20261025 (ec7ff79b39dcb24cf002436fe2438289255f5e97), not main. Branch CI has verification/build only, no deploy job. This is a source handoff gap, not evidence of an automatic Hub redeploy.
9. yggmetro-web has two release paths: guarded GitHub deploy workflow and Cloudflare Builds main trigger with empty build_command and deploy_command=npx wrangler deploy. Current root wrangler config has no build hook invoking shop-release-guard. The latter path does not invoke the repository's guard by its declared commands. No claim of an unapproved deployment caused by this trigger in this survey.

Four candidates requiring owner/current-source resolution, not proven deletable duplicates:
A. LIGHT_CF_WORKERS includes factory-district1, while operational Factory runs in factory-district. GitLab project87621354 config proves factory-district1 is an assets-only universal-workplace UI; do not replace/delete it as though it were the runtime Factory. Clarify monitoring intent.
B. wrangler.observatory.jsonc names ygg-observatory-map (absent); live map Worker is observatory-web. The similarly named config may represent a separate planned target; resolve before choosing one.
C. Greenhouse Pages canonical production is commit4628a862 from10Oct, latest successful preview is commit9230ac3e on atlas/request-event-readback from23Oct. Preview allowlist includes only feat/unified-workplace-personal-planner-20261016. These are different source routes, not proof preview is approved production.
D. pantheon-shop-sandbox-bridge is public-disabled and has no inbound Worker service binding in this account inventory. Its outgoing ShopCommerceRead binding remains. External callers/other bindings not proven absent, so deletion is not cleared.

Not duplicates to delete:
- CODE_PROVIDER and VISUAL_PROVIDER target factory-machinery through different named entrypoints.
- LIGHT PANTHEON default fetch and PANTHEON_LIGHT LightBridge serve different contracts.
- GO -> HubBridge -> AppTools is source dispatch; it is not an accidental circular relay.
- go-local-memory-mcp offers memory_* continuity tools backed by KV, distinct from GO Brain's brain_* tools and D1.
- observatory-web is a browser-local Leaflet map; observatory-shared-browser is the remote browser runtime.
- Shop sandbox and production are separate environments.
No additional runtime mutation occurred during this expanded survey.
