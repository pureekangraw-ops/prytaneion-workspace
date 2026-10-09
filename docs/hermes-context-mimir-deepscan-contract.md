# HERMES Context Intake + MIMIR Deep Scan — integration contract (draft)

Status: DESIGN / NOT DEPLOYED. Existing HERMES Reception and MIMIR retain ownership and permissions.

## HERMES Context Intake
Before create_work, look for an existing Work using the authorized reception search_work path. Link existing Work ID / Checkpoint ID and source references where authorized. Prefer resume_work over create_work for matching work. Missing evidence is UNKNOWN, never invented. No new identity, gate, station, or authority.

## MIMIR Deep Scan
Produce a read-only diagnostic overlay on an intake packet or authorized Work readback. Reuse existing MIMIR verification and provenance rules, including source permissions, freshness, conflicts and lineage. Output:
- EXPECTED: legitimately pending with evidence of an expected next event.
- NEEDS_CHECK: missing/conflicting/insufficient evidence.
- STALE: evidence or checkpoint past its explicit freshness deadline.
- FAIL: verified failure backed by evidence.
- CLEAR: checks pass.
Include reason codes, evidence refs, observedAt, checkedAt and suggested next action. Do not replace canonical Work status, mutate source records or infer failure merely from pending.

## Routing
GO intent -> HERMES Reception (context and duplicate check) -> MIMIR diagnostic (when needed) -> existing authorized Work/station/tool route. PIXIE remains Data Lifecycle and does not become an execution authority. High-risk/ambiguous results return to GO for review; simple CLEAR work should not be delayed by a new mandatory gate.

## Acceptance checks before implementation
1. Duplicate Work produces RESUME recommendation; no create_work call.
2. Unknown/missing source yields NEEDS_CHECK, not CLEAR.
3. Expired explicit freshUntil yields STALE.
4. Expected pending with evidence yields EXPECTED, not FAIL.
5. Confirmed failure yields FAIL with evidence refs.
6. Overlay never changes Work status, authorization, or owner.
7. Read-only checks do not create Work, deploy, or mutate storage.
8. Existing HERMES and MIMIR tests stay green.

Implementation requires tracing the active Metropolis Reception owner and MIMIR runtime integration; this file is a non-executable design handoff, not a claim that the feature is live.
