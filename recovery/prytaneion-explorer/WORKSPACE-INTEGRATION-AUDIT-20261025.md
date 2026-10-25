# Workspace integration checkpoint — 2026-10-25

Why this: reconcile newer main capabilities with the existing stacked Hub cutover and bounded Workspace contract, without replacing the backend or writing to live Drive.

Exact baselines read from remote before editing and checked again before publishing:
- GO main: 58c2b58832ab665a7ce44d47291cacd87ae75f6a
- GO PR19: fe9194ae8c7be18fa0a191a54b8bc4a952818bd9
- GO Hub base: da910a69c747b25936794499dcf2b2459901978a
- Provider main: 3764315bd60f3341e00362ed4ca603deac76f662
- Provider PR409: 1d43224f369243040d118f1efa7c3908729c06ef
- Provider Hub base: 622e7b28b60bc40b1b3e43325fbd0afbb2c7f66e
- Paired Hub fixture: 3da763a3083654fe69945da0e8e6d5e86eb706e3

GO candidate e5ad42de89a7a4bf8dd4d38063b0946fcffb9de7 is a normal merge of current main into PR19. It retains both parents, Hub entrypoint/bindings and Workspace contracts. The import conflict preserves the current-main Factory visual implementations. Additional regression tests reproduced missing Hub classification for factory_visual_upload, factory_visual_upload_status and factory_visual_zip_chunk, then verified schema/dispatch parity after fixing the classification. A second failing test found the private adapter's older 1 MB cap; it now preserves main's bounded 7 MB exception solely for visual upload. imageSplit remains advertised and covered by the imported main tests. Stamper features remain in separate GO PR21.

Provider main is already an ancestor of PR409; provider runtime requires no merge or code change. Only the paired CI pin and this audit record change.

Local evidence: GO 88/88; provider/Drive 62/62; actual GO -> pinned Hub -> provider -> synthetic SQLite Drive continuity passed, including source retry IDs, read lower bound, writer handoff, and literal workspace-continuity-ok SHA-256 readback. These are executable fixtures, not production, device, or live Drive proof. Native runtime and remote CI results are reported separately.

Read-only credential-selection evidence: workspace-continuity.mjs:88-90 passes GO_HUB_DIRECT_GOOGLE_ACCESS_TOKEN plus the CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN trio into createGoogleDriveService. That service prefers a complete refresh trio and otherwise uses the access token. read-service.mjs:191 onward uses the same preference and environment slots for the Hub Google probe. No secret values were inspected. This establishes source-level selection parity for valid configurations, not equality of deployed bindings or granted scopes. Validation differs (the probe rejects malformed credential characters; the service trims configuration). OAuth write scopes remain UNKNOWN.

No latency redesign: this integration does not alter the append implementation; existing synthetic append/contention/recovery checks pass. No live latency bound is asserted. No merge into main, deployment, release-lock removal, credential generation, scope expansion or live Drive write. Greenhouse and Vault remain paused. Retain the stacked draft bases and the separate release gates in WORKSPACE-RELEASE-PACKET.md.
