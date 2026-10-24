# Workspace continuity: bounded draft contract v1

Canonical bases: provider cutover 622e7b28b60bc40b1b3e43325fbd0afbb2c7f66e (PR408), GO cutover da910a69c747b25936794499dcf2b2459901978a (PR18), Hub V2 3da763a3083654fe69945da0e8e6d5e86eb706e3. Hub's active GO-owned refresh work is unchanged. No second Hub/Adapter service is created: the existing private ProviderTools Google group and Google Drive service carry this feature.

## Why this

A transport receipt cannot restore a work checkpoint or prove an artifact. Three small operations (read, write, receipt) preserve one Work ID and exact source/artifact references across callers. Drive remains storage, never an executor. The manifest records zone, blueprintVersion, repo/branch/commit, optional separately declared live identity, logical currentWriter and writerEpoch, checkpoint, evidence status/scope/reference, artifact reference/hash, and nextAction. Declared evidence and live identity are not independently verified by this adapter.

Only the configured Work ID and fixed 03-CHECKPOINTS folder under the existing YGG-WORKSPACE root are accepted. The adapter checks folder ancestry and file metadata. It never reads Recovery Vault, lists/mirrors Drive, PATCHes/deletes existing files, or moves folders. A receipt says STORED_READBACK_VERIFIED and execution NOT_ASSERTED. Reference-only artifact hashes remain REFERENCE_ONLY_UNVERIFIED. Inline synthetic artifact text is hashed and returned byte-for-byte as UTF-8, with INLINE_SHA256_VERIFIED.

## Atomicity and recovery

Each committed immutable version names exactly one pre-generated Drive ID for its successor. Every contender creates at that SAME ID. Drive uniqueness, not a read-then-write version comparison, selects the winner. Losers receive conflict and read the winning slot. The first slot is pre-generated once and explicitly configured. Official Drive documentation supports ordinary-file creation using pre-generated IDs and duplicate retry returning409: https://developers.google.com/workspace/drive/api/guides/manage-uploads . These files are JSON, not native Google Docs.

The adapter validates expectedVersion and expectedEpoch, requires the current logical writer, and increments the epoch on explicit handoff. Old writers cannot append after handoff. Writer labels are owner-selected labels, NOT authentication credentials; all callers remain within the existing private owner boundary. No leases or automatic stale-owner stealing are introduced.

writeRequestId identifies the source operation and its content hash. Retry with identical content returns the original stored version; changed content conflicts. GO transport message IDs stay fresh, since Hub deduplication does not retain full source responses. On interrupted create, the adapter reconciles the same slot once. Unresolved absence/failure returns WORKSPACE_WRITE_UNCERTAIN, never automatic resubmission. Caller must use receipt/read and then explicitly retry identical content if appropriate. No retry daemon.

Limits: one work, max63versions, bounded128KiB stored envelopes and16384-character inline artifacts. SHA256 chaining detects corruption but is NOT a signature or protection from a Drive owner rewriting the whole chain. External deletions/edits and quota/storage/auth failures remain possible. A clean fixture context proves durable readback, not disaster recovery of live credentials or independent actors.

## Configuration and live boundary

WORKSPACE_CONTINUITY_CONFIG is plain configuration: {"workId":"WORK-ONE","rootFileId":"PREGENERATED_DRIVE_ID","initialWriter":"GO","writers":["GO","ATLAS"]}. No live value was set. The adapter reuses existing GO_HUB_DIRECT_GOOGLE_* authentication; no secrets were read or created, scopes expanded, or Drive files changed. Existing token write permission is UNKNOWN. Discovery alone does not imply configured write access.

Before a live trial, parent must review both candidates and authorize deployment/configuration plus one bounded synthetic work's new files. Verify existing credentials already permit the operations without exposing values; any permission expansion needs separate approval. Prepare the root ID once through the supported Drive API, then persist it in approved configuration. Do not regenerate on retry. No live GO execution capability is claimed.

## Reproducible evidence

node --test recovery/prytaneion-explorer/{worker,provider-mcp,workspace-continuity}.test.mjs tests/go-hub-google-drive-{service,mcp}.test.cjs

HUB_SOURCE=/path/to/pinned/hub GO_SOURCE=/path/to/paired/go node recovery/prytaneion-explorer/workspace-hub.integration.mjs

The integration uses actual GO handler → pinned Hub private rail/D1 fixture → provider MCP → SQLite-backed synthetic Drive HTTP responses. No network fallback. It checks schema parity, source replay, fresh transport receipts, GO checkpoint, new caller context, GO→ATLAS handoff, artifact and exact version/receipt readback. Work WORK-ONE reaches version3. Literal artifact workspace-continuity-ok has SHA256 9a11ff78a9f8b20ed182af1436d66680ba0524818aaec0453e29123a06e686d9. Seven Hub receipts report RESPONDED with taskSuccess null. These are fixture IDs and logical labels, not live Drive/GO/Atlas proof.

Focused tests cover database close/reopen, atomic competing creates, idempotency conflict, stale version/epoch, interrupted pre-write and lost response, approval/scope/hash/config rejection, corruption, private MCP routing. Existing Worker, provider and Google service regressions remain included. No live jobs were rerun.
