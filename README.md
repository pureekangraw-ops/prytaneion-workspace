# PRYTANEION — Logic Workspace

PRYTANEION is the primary **Logic Workspace** where BIG and GO turn intent into continuous, traceable work.

It owns work identity, context, reasoning, planning, coordination, evidence/readback, and continuation. It is **not** the Factory and does not make route, handoff, pointer, or trigger into authority.

## Core Flow

```text
Intent
→ Mission
→ Current Work
→ Context
→ Plan / Logic
→ Select Capability
→ Execute / Dispatch
→ Evidence / Readback
→ Continue or Close
```

## Current Boundary

**PRYTANEION owns**
- Mission and Requested Result
- stable Work ID + Checkpoint
- Current Work and selected context
- planning and logic
- capability/tool selection
- execution coordination
- evidence and readback
- blocker / next action
- continuation and close

**PRYTANEION does not own**
- idea/visual experimentation owned by ERGASTERION / PIXIE LAB
- production/build machinery merely because legacy Factory code is still present
- system-wide update governance
- historical truth
- time/trigger truth
- external source truth

Legacy Factory/build/QC/assembly surfaces are being separated from the Logic Workspace in evidence-backed deltas. Do not treat their presence in this repository as the target architecture.

## Work Identity

One continuing job keeps the same Work ID even when tools, agents, capabilities, or outputs change.

```text
Work
├── work_id
├── checkpoint_id
├── mission
├── requested_result
├── owner
├── current_state
├── work_context
├── current_card
├── selected_artifacts
├── blocker
├── next_action
├── evidence
├── receipt
├── return_condition
└── retrieval_alias
```

Identity and operational state are separate:
- **Work ID** = stable identity
- **Checkpoint** = progress pointer
- **Session** = conversation or connection
- **WorkContext** = selected context carried into work
- **Card** = current governed-tool access declaration
- **Receipt** = evidence that an action occurred
- **Evidence** = support that the result is real
- **Retrieval alias** = lookup pointer, not identity

## Tool Access and Authority

For a governed room/tool entrance, authority is deliberately simple:

```text
current_card.tool_access contains exact canonical tool/room name
→ OPEN

name absent
→ DENY
```

Rules:
- `tool_access` is the authority field for governed tool/room entry.
- `access_scope`, destination, route, pass, pointer, handoff, and trigger do **not** grant authority.
- Read-only reality sensors are observation surfaces, not governed room entrances.
- Tool availability does not grant ownership.
- HERMES may search, classify, analyze, and recommend; a recommendation is not authority.

## Context and Current Truth

PRYTANEION retrieves and organizes relevant files, prior work, decisions, references, provenance, and evidence.

Context must remain separate from Current Truth. A pointer, memory, mirror, historical record, or old route is not automatically authoritative.

## Handoff

A handoff carries only the minimum context needed to act and return:

- Work ID
- Checkpoint
- Requested Result
- selected context
- required capability/tool
- evidence
- return condition

Crossing a workspace or capability boundary does not transfer ownership or authority.

## Review and Reality

The Workspace must distinguish:
- produced artifact
- action receipt
- evidence
- verified result
- unknown state

```text
Artifact created ≠ Requested Result achieved
Action receipt   ≠ Verified outcome
Tool success     ≠ Reality success
Deploy completed ≠ User-facing result verified
```

Completion follows:

```text
Claim → Owner Source → Evidence → Readback → Verdict
```

Valid verdicts include `DONE / VERIFIED`, `UNKNOWN`, `WAIT_VERIFY`, `BLOCKED`, and `CONFLICT`.

## System Language

| Term | Meaning |
| --- | --- |
| SOURCE | Origin entitled to state a fact |
| OWNER | Responsible owner of a state or effect |
| CURRENT | Current truth supported by its responsible owner/source |
| POINTER | Reference to a source; not truth itself |
| DELTA | Proposed change to Current |
| HANDOFF | Context transferred to another owner/capability |
| TRIGGER | Reason to wake or check; not authority |
| ARTIFACT | Produced output; not proof of success |
| EVIDENCE | Observable support for a claim |
| VERIFIED | Evidence proves the Requested Result |
| HISTORY | Previous truth that cannot reactivate itself |
| UNKNOWN | Insufficient evidence; do not guess |

## Core Laws

```text
ACCESS ≠ OWNERSHIP
CONTEXT ≠ CURRENT TRUTH
POINTER ≠ TRUTH
HANDOFF ≠ AUTHORITY
TRIGGER ≠ AUTHORITY
ARTIFACT ≠ VERIFIED
HISTORY ≠ CURRENT
DO ≠ DONE
```

## Standard Lifecycle

1. **Understand** — resolve intent, Requested Result, constraints, preserve/change intent, and UNKNOWNs.
2. **Resolve** — find existing Work first; create new Work only when it is actually new.
3. **Contextualize** — collect relevant context, provenance, artifacts, decisions, and evidence.
4. **Plan / Logic** — determine the working direction and next correct action.
5. **Select Capability** — choose a tool/capability that can perform the required effect.
6. **Execute / Dispatch** — act only through currently authorized governed tools.
7. **Review** — inspect artifact, receipt, evidence, and Requested Result separately.
8. **Verify** — read back from the responsible source.
9. **Continue or Close** — preserve the same Work/Checkpoint while work remains; close only with evidence.

## Continuation and Retry

- Reuse the existing Work ID for continuing work.
- Reuse the Checkpoint while it remains valid.
- Do not create duplicate Work or dispatch state merely to recover context.
- If an action already has a verified receipt/result, return the existing result.
- If evidence is incomplete, wait for verification instead of retrying blindly.
- If Action Identity or authority is unknown, fail closed as `UNKNOWN`.

## Current Implementation Note

The Logic Workspace boundary is now explicit in code: the Logic Workspace projection is separate from the legacy Factory authority projection. Legacy production compatibility remains temporarily available while Factory/build/QC/assembly dependencies are separated safely.

This is a migration boundary, not permission to delete working production capability without identifying its responsible owner and verifying the replacement path.

## Non-Goals

PRYTANEION is not:
- a Factory
- a replacement for every production system
- the owner of every artifact
- a universal database of truth
- a route/pass system that grants authority
- a trigger system that grants authority
- a memory dump
- a chat surface that declares success without evidence

## Success

A user should be able to enter with a simple intent and continue the same mission until a real, evidence-backed result exists without losing identity, context, provenance, ownership, current state, or verification status.

The product succeeds when the **next correct action is visible** while Reality, Ownership, Evidence, and Continuity remain intact.
