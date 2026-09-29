PRYTANEION is the primary AI Workspace where BIG and GO turn intent into continuous, traceable work.
It is the place to understand, organize, design, coordinate, review, and continue work. It is not the factory that produces every artifact itself.
## Core Experience
```text
Intent
→ Mission
→ Current Work
→ Context
→ Plan / Design
→ Dispatch
→ Review
→ Evidence / Readback
→ Continue or Close
```
## Product Role
PRYTANEION owns the Workspace and the continuity of active work.
It keeps the mission understandable, preserves the identity of continuing work, gathers the right context, coordinates responsible capabilities, and returns the work to a verified state.
PRYTANEION does not automatically own:
- production or build execution
- system-wide update governance
- historical truth
- time or trigger truth
- external source truth
Those responsibilities remain with their responsible systems.
## Core Capabilities
### 1. Mission Intake
Accept:
- natural-language requests
- files, images, links, and references
- new work or continuation of existing work
- requested result
- constraints
- preserve / change intent
- explicit and implicit UNKNOWN states
The intake layer must distinguish a new mission from a continuation before creating anything.
### 2. Current Work
Every active mission is represented by a Current Work record containing:
- stable Work ID
- Checkpoint
- current owner
- current state
- requested result
- current context
- blocker
- next action
- evidence
- current card
One continuing job keeps the same Work ID even when tools, destinations, agents, or outputs change.
### 3. Context Workspace
Retrieve and organize:
- relevant files and prior work
- research and references
- previous decisions
- product and design context
- source and provenance
- current evidence
- known and unknown information
Context must remain separate from Current Truth. A pointer, memory, mirror, or historical record is not automatically authoritative.
### 4. Planning & Design Workspace
Support the transition from intent to an approved working direction:
- brief
- structure
- user flow
- ideas and references
- design direction
- working canvas
- alternative comparison
- critique
- revision
- approval
PRYTANEION prepares and coordinates the design. Responsible production systems may create the final artifact.
### 5. Tool and Capability Access
PRYTANEION may use or dispatch the capabilities required by Current Work.
Tool availability does not grant authority. Every dispatch must respect:
- current Work
- requested result
- route
- owner
- authority
- scope
- return condition
### 6. Artifact Workspace
Display and organize artifacts belonging to the Work:
- text
- images
- designs
- code
- documents
- builds
- versions
- references
An artifact is an output of production. It is not proof that the Requested Result has been achieved.
### 7. Review and Reality
The Workspace must distinguish:
- produced artifact
- action receipt
- evidence
- verified result
- unknown state
Creating something does not mean the Requested Result is complete.
### 8. Continuity
Work must survive:
- conversation changes
- tool changes
- temporary interruption
- agent or persona changes
- route changes
Resume from Current Work and Checkpoint instead of recreating the job.
### 9. Handoff
Send the minimum usable context to the responsible owner or tool without accidentally transferring ownership or authority.
A handoff should include only what the receiver needs to act and return a result:
- Work ID
- Checkpoint
- Requested Result
- selected context
- route
- authority boundary
- evidence
- return condition
### 10. User Control
BIG remains Final Authority for decisions requiring owner approval.
PRYTANEION should ask only when information, authority, or verification is genuinely required. It should not ask BIG to repeat information that can be recovered from the Workspace or Owner Source.
## System Language
| Term | Meaning |
| --- | --- |
| SOURCE | Origin entitled to state a fact |
| OWNER | Responsible owner of a state or effect |
| CURRENT | Current truth supported by its responsible owner/source |
| POINTER | Reference to a source; not truth itself |
| DELTA | Proposed change to Current |
| HANDOFF | Context transferred to another owner |
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
## Work Object Model
```text
Work
├── work_id
├── checkpoint_id
├── mission
├── requested_result
├── owner
├── authority
├── route
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
Identity must remain separate from operational state:
- Work ID = stable identity
- Checkpoint = progress pointer
- Session = conversation or connection
- WorkContext = selected context carried into work
- Card = currently authorized path and scope
- Receipt = evidence that an action occurred
- Evidence = support that the result is real
- Retrieval alias = lookup pointer, not identity
## Standard Work Lifecycle
### Understand
Resolve the latest intent, requested result, constraints, preserve/change intent, and UNKNOWN states.
### Resolve
Find an existing Work first. Reuse the same Work ID when the mission continues. Create a new Work only after the absence of a suitable existing Work is confirmed and creation is approved.
### Contextualize
Collect relevant context, artifacts, decisions, provenance, and evidence. Keep Current Truth separate from pointers and history.
### Plan / Design
Produce the brief, structure, user flow, design direction, alternatives, and approval state required for the requested result.
### Dispatch
Route the work to the responsible tool, agent, or production system within the existing authority and scope.
### Review
Inspect the produced artifact, receipt, evidence, and requested result separately.
### Verify
Read back from the responsible source and confirm that Reality matches the Requested Result.
### Continue or Close
Resume on the same Work and Checkpoint when work remains. Close only when evidence supports the Requested Result and no material UNKNOWN remains.
## Authority and Routing
PRYTANEION coordinates the Workspace. It does not silently become the owner of external truth or production state.
Before dispatch, resolve:
- who owns the requested effect
- which source is authoritative
- which route is allowed
- what authority is required
- what scope is permitted
- how the result will be verified
If route, authority, or owner is unclear, keep the state UNKNOWN and stop before mutation.
## Artifact and Verification Rules
```text
Artifact created       ≠ Requested Result achieved
Action receipt         ≠ Verified outcome
Tool success           ≠ Reality success
Deploy completed       ≠ User-facing result verified
```
A completion claim should follow:
```text
Claim
→ Owner Source
→ Evidence
→ Readback
→ Verdict
```
The valid verdicts are:
- DONE / VERIFIED
- UNKNOWN
- WAIT_VERIFY
- BLOCKED
- CONFLICT
## Continuation and Retry Rules
- Reuse the existing Work ID for continuing work.
- Reuse the existing Checkpoint when it is still valid.
- Do not create duplicate Work, Checkpoint, or dispatch state to recover context.
- If the same action already has a verified receipt and result, return the existing result.
- If evidence is incomplete, wait for verification instead of retrying blindly.
- Dispatch a new action only when the Action Identity and Delta are demonstrably new.
- If Action Identity is unknown, fail closed.
## Minimal User Experience
PRYTANEION should expose a small number of coherent surfaces:
1. **Mission Intake** — start or continue work
2. **Current Work** — see identity, state, blocker, and next action
3. **Context Workspace** — inspect sources, decisions, and evidence
4. **Planning / Design Canvas** — shape the requested result
5. **Artifact Workspace** — inspect outputs and versions
6. **Review / Approval** — make owner decisions
7. **Run / Evidence View** — follow dispatch, receipt, verification, and continuation
The interface should reduce navigation and preserve continuity rather than expose every internal object as a separate screen.
## Non-Goals
PRYTANEION is not:
- a replacement for every production system
- the owner of every artifact
- a universal database of truth
- a trigger system that grants authority
- a memory dump
- a chat interface that declares success without evidence
- a reason to create a new Work for every variation
## Success Criteria
A user should be able to enter with a simple intent and keep working on the same mission until a real, evidence-backed result exists without losing:
- identity
- context
- provenance
- authority
- continuity
- current state
- verification status
The product succeeds when it makes the next correct action visible while keeping Reality, Ownership, and Evidence intact.