# YGG Workspace release preparation — 2026-10-24 18:43 UTC

Initial read-only preparation followed by parent-authorized feature-branch integration. No main merges, Drive writes, deployments or settings/credential changes. GO main e9fde75e was merged normally into the existing feature branch (merge ff51db60881583528418dc3356a0333f21cca51d); final GO candidate fe9194ae8c7be18fa0a191a54b8bc4a952818bd9 includes focused integration tests. 78 GO tests pass, including all three added GOVIEW commands through the Hub app adapter and owner boundary. Independent diff review remains pending.

## Verified source and rollback metadata

| Component | Current canonical/source | Reviewed candidate | Live rollback version |
|---|---|---|---|
| Provider | main3764315bd60f3341e00362ed4ca603deac76f662; cutover622e7b28b60bc40b1b3e43325fbd0afbb2c7f66e | PR4092050288f6f9674c05eb09eed3b93641660e4bb67 | 548808b7-bf0a-4e72-9e64-ff6a3ad47a99 |
| GO | main e9fde75e5e27cd44c1dcbd6f525ea9beb0c1f574; cutover da910a69c747b25936794499dcf2b2459901978a | PR19 fe9194ae8c7be18fa0a191a54b8bc4a952818bd9 | 4f21eebe-940b-4a00-bf1b-49bbd88e2392 |
| Hub V2 | branch4791cad1142a546029263b8420f3063935c83842, docs-only after code3da763a3083654fe69945da0e8e6d5e86eb706e3 | unchanged | aa59cd95-e569-482b-a9ee-40cb6d3b199d |

Each live version serves100%. Deployment IDs: provider4cc5716e-fe9d-4808-95db-8f89861bfd41; GO c7f94695-834c-4f83-9d81-2cfc42252094; Hub5d809217-cbc1-4027-af66-d87c25434d91. Provider version annotation identifies622e7b28; Hub identifies3da763a. GO has no commit annotation: its message identifies direct-map changes preserving Hub/assets/OAuth, but exact live source SHA remains UNKNOWN, not inferred from main.

Provider preserves all seven existing secret bindings; Google client ID/client secret/refresh token are secret_text. No WORKSPACE_CONTINUITY_CONFIG exists. GO live bindings include HUB_V2→ygg-connection-hub-v2/HubBridge, GOVIEW_GO→goview-package-bridge/GoviewGoBridge, OBSERVATORY_GO→observatory-shared-browser/ObservatoryGoBridge, FACTORY_DIRECT→factory-district, DB, ASSETS, owner/Access/OAuth settings and existing secrets. Hub binds GO_APPS→go-together/AppTools, PROVIDERS→prytaneion-explorer/ProviderTools and HUB_DB. Preserve all; add no permissions/bindings to GO or Hub.

## Blocking findings

1. RESOLVED IN CODE, REVIEW PENDING: GO main contained newer GOVIEW tools/dispatch in worker/index.js and worker/goview-direct.mjs absent from the reviewed cutover candidate: goview_propose_pin, goview_focus_point, goview_command_status. Do not directly deploy PR19's old base. Next action: coordinated normal integration of current main into the existing cutover-based candidate, retaining Hub entrypoint/routing and all live assets/bindings, followed by focused CI and independent review of the changed head. Now integrated by normal feature-branch merge and tested; no changes to main or cutover target branch. Request independent review of e743e52..fe9194a before release.
2. Existing provider OAuth write scope UNKNOWN. Secret names cannot prove scopes. Existing sanitized probe only performs Drive files.list and does not return granted scopes. Separate Google Drive connector metadata proves neither provider identity nor provider write authority. No supported current sanitized scope-inspection entrypoint was found. Next action: existing credential custodian supplies scope-only evidence for THIS provider credential (drive or appropriate drive.file grant plus target-folder access), without sending tokens or rotating keys. If inadequate, stop: permission expansion requires separate explicit approval. Do not silently test scope by creating a file.
3. Provider root Google service/workflow changes would trigger legacy .github/workflows/go-hub-deploy.yml on a main merge; its paths-ignore does not exclude these files. Avoid main merge/legacy go-hub deploy. Proposed release uses existing cutover branch integration and direct version upload/deployment of prytaneion-explorer only. Eventual main promotion needs separate workflow-safe coordination.

## Exact target and pilot

Verified via files.get metadata: 03-CHECKPOINTS, application/vnd.google-apps.folder, ID1zXE9WehOb_dE1M53wUfb6AipWaIs-auK, parent YGG-WORKSPACE1z7oD62E_zdJe9gbl6ZoA4brtcoPeykSq. No Recovery Vault contents accessed. The connector response did not expose canAddChildren; do not infer it.

One Work ID: YGG-CONTINUITY-PILOT-20261024-01. Exactly THREE successful new JSON files, no folder creation, PATCH, delete or separate artifact upload:
- workspace-<R0>.json: version1, GO checkpoint, requestId pilot-checkpoint-1.
- workspace-<R1>.json: version2, GO explicitly hands off to ATLAS, epoch1, requestId pilot-handoff-2.
- workspace-<R2>.json: version3, ATLAS records literal workspace-continuity-ok inline, requestId pilot-result-3.

R0 is allocated once by Drive generateIds and persisted in configuration; each record allocates its successor R1/R2/R3. Names are exactly the above deterministic format after IDs exist; literal IDs cannot be known without allocation. R3 remains an unused reserved ID, not a fourth file. No live fault injection or automatic retry. Any uncertainty stops mutation and reconciles receipt/read, never creates a replacement Work ID. Retain the three synthetic files; cleanup is not implicitly authorized.

Config delta on provider only, plain_text WORKSPACE_CONTINUITY_CONFIG:
{"workId":"YGG-CONTINUITY-PILOT-20261024-01","rootFileId":"<R0>","initialWriter":"GO","writers":["GO","ATLAS"]}

This activates application writes for this one work using existing credentials. It expands application functionality, not OAuth scopes/IAM. Writer labels remain logical; pilot cannot prove distinct authenticated actors or execute GO autonomously. Parent/owner must authorize the synthetic writes/configuration; no claim of present authorization to perform them in this preparation turn.

API envelope after approval:
- Four GET /drive/v3/files/generateIds?count=1&space=drive&type=files total: R0 provisioning plus one per committed version.
- Bounded GET /drive/v3/files/<folder-or-record>?fields=... metadata; GET /drive/v3/files/<record>?alt=media for visible log records. Existing provider may refresh OAuth internally; tokens never leave runtime.
- Exactly three successful POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id, JSON metadata with fixed Checkpoints parent and pre-generated id, plus bounded JSON record. No other Drive mutations.
- Through supported owner GO MCP: google_workspace_write with stable writeRequestId, google_workspace_read with minimumVersion from last receipt, google_workspace_receipt for exact writes. New caller context resumes SAME Work ID; it is not proof of autonomous GO execution. Verify exact artifact UTF-8 SHA2569a11ff78a9f8b20ed182af1436d66680ba0524818aaec0453e29123a06e686d9, manifestHash versus returned manifest, recordHash, provenance, and historical exact versions. latest remains UNKNOWN; receipt is stored-byte verification, execution NOT_ASSERTED.

## Conditional release sequence (not executed)

1. Resolve GO source divergence and scope evidence above; parent obtains independent approval of integrated exact head. Re-read deployment versions/settings immediately before mutation and stop on unexpected drift.
2. Merge reviewed candidates into their EXISTING cutover targets with expected heads; do not merge provider to main or trigger unrelated legacy release. Coordinate GO current writer before integration/merge.
3. Release provider first using existing Cloudflare version upload/deployment path, retaining all seven secrets/current settings. Allocate R0 once through approved supported provisioning path and add only the above plain configuration. If no supported credential-preserving provisioning route is available, stop before configuration; never extract a token into tooling.
4. Release integrated GO candidate retaining current static assets, DB, owner OAuth/Access and all four service bindings. No Hub deployment; its automatic source discovery can expose provider schemas. Confirm server/catalog visibility through supported tools. A stale client catalog blocks the pilot; no schema-validation bypass.
5. Run the three-file pilot only after both versions and routing/configuration are verified. Read back bytes/receipts and report actual IDs; mark failures/uncertainty explicitly.
6. If release fails, restore GO version4f21eebe-940b-4a00-bf1b-49bbd88e2392 and provider548808b7-bf0a-4e72-9e64-ff6a3ad47a99 using supported version rollback, preserving credentials. Restore prior absence of pilot config if not restored by version rollback. Do not delete any pilot files. Hub stays untouched.

Approval packet requested via parent: authorize the necessary GO source integration/review separately from this read-only preparation; then approve the exact reviewed release versions, one plain config addition, root-ID allocation and three synthetic JSON files at the stated folder, with no expanded credential scope. Scope proof and supported R0 provisioning are prerequisites, not permission to invent a credential route.

Scope endpoint assessment: existing provider google_status uses fixed Drive files.list fields=kind and returns sanitized connection status. Its supported contract has no granted-scopes output. No current scope-reporting endpoint was found; no tokens inspected, transmitted to tokeninfo, or extracted. Custodian scope-only evidence remains required. The one-work, three-file pilot above is unchanged. Provider PR409 and GO PR19 retain base go/hub-v2-cutover-20261024, so feature pushes/PR integration do not target main or trigger the unrelated legacy go-hub release.
