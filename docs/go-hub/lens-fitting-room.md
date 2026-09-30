# Lens Fitting Room

**Status:** CURRENT  
**Work:** `WORK-LENS-FITTING-ROOM-20260930-001`  
**Scope:** PRYTANEION optional fitting rooms

## Boundary

Lens Fitting Room is an optional sibling of Agent Persona Room. Persona Fitting chooses a temporary Persona/role; Lens Fitting chooses the viewpoint/framework GO uses to think and work.

Lens Fitting is not a mandatory gate. Entering or leaving it does not change Work ID, Checkpoint ID, owner truth, route, authority, Pass, tool access, or Persona semantics. A selected Lens is working data only.

GO is the chooser. The room may list or compare candidates, but it never auto-selects. An explicit `select` stores the current selection under Work Tablet `data.lensSelection`. Selecting again replaces that value on the same Tablet; it does not create a new Work.

The room exits immediately after a selection and the Work continues at the same identity. The Tablet remains the portable working context; Centre remains current owner truth.

## Canonical Lens set

The runtime catalog is sourced from the user-provided `GO — NEW LENS SET` and preserves the Persona survivors boundary from `GO — PERSONA SURVIVORS`:

- **EVIDENCE** — evidence entitlement, gaps, and FACT / INFERENCE / UNKNOWN.
- **CURRENT** — freshness, change, pending work, deadlines, and stale residue.
- **SYSTEM** — components, location, connection, dependency, collision, and continuity.
- **ESSENCE** — real function, meaning, intent, common core, and non-flattenable differences.
- **FRICTION** — duplication, clutter, bottleneck, misplaced responsibility, and residue.
- **FORM** — structure, flow, and experience fit against intent.
- **CONSEQUENCE** — variables, assumptions, constraints, capability, trade-offs, and downstream effects.
- **ACTION** — the needed transformation type; it does not perform a Skill or grant capability.

Persona remains a separate temporary working identity. The four survivor Personas (Operations Chief, Housekeeper, Forge, and Teacher) are not converted into Lens entries, and Optician remains the fitting/refitting concern above the Lens layer.

## Runtime door

- MCP tool: `go_hub_agent_lens_room`
- Actions: `list`, `compare`, `select`
- Existing Work Tablet write surface: HERMES `update_tablet`
- Runtime module: `go-hub-agent-lens-room.mjs`
- Tests: `tests/go-hub-agent-lens-room.test.cjs`
