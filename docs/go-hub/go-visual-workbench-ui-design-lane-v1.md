# GO Visual Workbench — UI Design Lane

**Status:** Design draft / implementation contract  
**Branch:** `design/go-visual-workbench-ui-design-lane-v1`  
**Scope:** Extend the existing PIXIE Visual Workbench; do not create a new top-level app or production authority.

## 1. Product definition

GO Visual Workbench is a lightweight UI/visual design editor for the workflow:

```text
Visual Workbench
→ Approved Design
→ PIXIE
→ Code / Asset
→ Preview
→ Readback
```

It is **not** a Figma clone. It should cover the design work GO actually performs while preserving the system's existing contracts:

- `Work ID`
- decision and prompt lineage
- source references
- draft/version separation
- explicit approval state
- PIXIE handoff
- preview and verification evidence

The target is approximately 95% of the team's common design workflow, not 95% of Figma's feature surface.

## 2. Existing boundary

The UI Design Lane belongs inside the existing PIXIE/ERGASTERION path. It must reuse the current command envelope, workbench state, render packet, handshake, verification, and non-authority rules.

Existing Visual Workbench behavior already establishes:

- reference and brief are separate from the working result;
- drafts are source-locked and comparable;
- render packets are requests, not approvals;
- external execution is explicit;
- verification requires evidence;
- browser UI does not receive image-generation or production authority.

The UI Design Lane adds a structured scene graph and UI semantics without weakening those boundaries.

## 3. Product boundary

### In scope

- frame-based UI design
- lightweight vector editing
- basic auto-layout
- components and variants
- simple prototype interactions
- grid, ruler, snap, constraints
- typography and color tokens
- responsive frame preview
- SVG, PNG, and WebP export
- inspect panel
- version, compare, and restore
- provenance and approved-state handoff

### Explicitly out of scope

- plugin ecosystem
- deep multiplayer editing
- enterprise design-system administration
- full Dev Mode
- marketplace/community layer
- advanced illustration suite
- full video/timeline editor
- 3D editor
- unrestricted arbitrary scripting inside a design file

## 4. Product lanes

```text
PIXIE VISUAL
├─ Image / Reference
├─ UI Design Lane        ← this document
├─ Motion / Living Scene
├─ Theme / Web Asset
└─ Export / Publish
```

The lanes may share projects, assets, versions, provenance, and verification, but each lane must keep its own capability contract.

## 5. V1 — Governed UI Canvas

V1 must complete one useful vertical slice from design to preview.

### Canvas and scene

- desktop, tablet, and mobile frames;
- layer tree with stable node IDs;
- select, move, resize, duplicate, group, and frame;
- rectangle, ellipse, line, image, text, and basic pen/path;
- fill, stroke, radius, opacity, and basic typography;
- grid, ruler, snap, alignment guides, and spacing guides.

### Auto-layout core

```text
direction: row | column
gap
padding
align
justify
width: fixed | hug | fill
height: fixed | hug | fill
```

V1 only needs to support common UI structures: buttons, cards, toolbars, sidebars, lists, dashboards, and responsive sections.

### Prototype core

- click → frame;
- click → state;
- click → overlay;
- named page/state targets;
- no arbitrary code execution.

### Inspect panel

The inspector must expose:

- position and dimensions;
- padding, gap, alignment, and sizing mode;
- typography and color;
- border and radius;
- parent and child relationship;
- token references;
- component/variant reference when present;
- provenance and approval status.

### Export

V1 exports:

- SVG;
- PNG;
- WebP;
- canonical JSON scene document.

The JSON scene document is a first-class artifact. Raster export alone must not be treated as the design source.

### Versioning

```text
Draft
→ Snapshot
→ Compare
→ Restore
```

Every snapshot must retain its parent version, schema version, change summary, and evidence references.

## 6. V1.5 — Components, Variants, Tokens

### Components

Start with a small semantic set:

```text
Button
├─ default
├─ hover
├─ pressed
└─ disabled

Card
├─ default
├─ featured
└─ compact

Icon
├─ default
├─ active
└─ disabled
```

A component is not only a visual group. It is a reusable semantic unit with a stable identity, state, token references, and approved-version lineage.

### Tokens

Start with only useful tokens:

```text
color.*
spacing.*
radius.*
font.*
shadow.*
motion.*
```

Do not build enterprise design-system governance before the workflow proves that it is needed.

### Additional interactions

- hover → variant/state;
- click → overlay;
- modal and drawer;
- navigation state;
- simple transitions;
- responsive state mapping.

### Additional vector operations

- node edit;
- convert shape to path;
- union;
- subtract;
- intersect;
- basic corner editing.

Use a proven geometry implementation where possible. Do not make a complete vector-illustration engine a prerequisite for the UI workflow.

## 7. V2 — Design-to-execution bridge

V2 turns an approved design into a governed handoff.

### Design lifecycle

```text
DRAFT
→ REVIEW
→ APPROVED
→ HANDED_OFF
→ RENDERED
→ VERIFIED
```

Rules:

```text
DRAFT != APPROVED
ARTIFACT != VERIFIED
RENDERED != PUBLISHED
UNKNOWN != PASS
```

Only an approved version may produce an authoritative handoff packet.

### Handoff

```text
Approved Design
→ structured handoff packet
→ PIXIE / Factory
→ code or asset output
→ browser preview
→ readback
```

The handoff packet should include:

- design ID and approved version;
- scene JSON or canonical scene reference;
- frame targets;
- component and variant states;
- token map;
- asset references;
- responsive rules;
- Work ID and checkpoint;
- evidence and unknowns.

### Design-to-code output

Do not build full Dev Mode in V2. Export only what the workflow needs:

- semantic HTML structure;
- CSS variables;
- layout metadata;
- component states;
- responsive breakpoints;
- asset references;
- token map.

### Readback

Compare approved design against rendered preview for:

- dimensions;
- spacing;
- typography;
- color;
- responsive behavior;
- missing assets;
- component states;
- overflow and overlap.

## 8. V3 — Workflow moat

V3 should deepen GO's unique advantage instead of copying Figma's ecosystem.

Candidate capabilities:

- design decision graph;
- design-to-work linkage;
- prompt/source lineage per design or node;
- approved-state audit trail;
- compare design, code, and runtime;
- evidence bundle per release;
- restore design and handoff contract together;
- PIXIE generation with design context;
- responsive scenario testing;
- design-change impact analysis.

Multiplayer, plugins, marketplace, and enterprise administration remain optional and must not enter the core architecture by assumption.

## 9. Canonical scene model

The editor must use a stable, typed scene graph rather than treating the DOM as the source of truth.

```json
{
  "schemaVersion": 1,
  "designId": "DESIGN-...",
  "workId": "WORK-...",
  "approvedVersionId": null,
  "frames": [
    {
      "frameId": "FRAME-MOBILE-001",
      "name": "Mobile",
      "width": 390,
      "height": 844,
      "children": ["NODE-BUTTON-001"]
    }
  ],
  "nodes": [
    {
      "nodeId": "NODE-BUTTON-001",
      "kind": "COMPONENT_INSTANCE",
      "parentId": "FRAME-MOBILE-001",
      "componentId": "button",
      "variant": "primary",
      "state": "default",
      "layout": {
        "mode": "HUG",
        "padding": [12, 20],
        "gap": 8,
        "align": "CENTER"
      },
      "style": {
        "fill": "color.action.primary",
        "radius": "radius.md"
      },
      "provenance": {
        "workId": "WORK-...",
        "decisionRef": "DEC-...",
        "promptRef": "PROMPT-...",
        "sourceRef": "SOURCE-...",
        "approvedVersionId": null,
        "evidenceRefs": []
      }
    }
  ],
  "interactions": [],
  "tokens": {}
}
```

### Model invariants

1. Node IDs are stable across versions.
2. A version is immutable once snapshotted.
3. The original source is never overwritten.
4. A draft cannot claim approval.
5. Unknown checks block verification and publication.
6. Provenance is additive; it must not be silently discarded during export.
7. External execution uses a packet and returns a receipt/evidence reference.

## 10. Implementation architecture

```text
UI Design Lane
├─ Canvas UI
├─ Scene Graph
├─ Layout Engine
├─ Component / Variant Registry
├─ Token Registry
├─ Prototype State Machine
├─ Version / Diff / Restore
├─ Inspect Panel
├─ SVG / PNG / WebP Exporters
├─ Provenance Layer
├─ Approval Gate
├─ PIXIE Handshake
└─ Preview / Readback
```

Recommended rendering order:

```text
DOM/SVG first
→ inspectable scene
→ deterministic export
→ semantic handoff
→ Canvas/WebGL only when performance evidence requires it
```

The existing `go-hub-visual-workbench-model.js` remains the compatibility boundary for the current image/reference workflow. UI scene state should be added as a separate schema lane rather than weakening the existing image state schema.

## 11. Build / borrow / integrate

### Build in GO

- scene graph contract;
- Work ID and provenance;
- approval lifecycle;
- version compare and restore;
- PIXIE handshake;
- preview and readback;
- evidence model;
- workflow-specific UX.

### Borrow or integrate

- vector geometry and boolean operations;
- text measurement;
- layout calculation;
- SVG parsing;
- image encoding;
- rendering primitives.

The goal is to own the workflow and contracts, not every low-level graphics algorithm.

## 12. Acceptance criteria

### V1 vertical slice

```text
Create a mobile frame
→ add card and button
→ apply auto-layout
→ preview desktop/tablet/mobile
→ inspect spacing and styles
→ bind Work ID and decision
→ export SVG/PNG/WebP
→ create a new version
→ compare
→ restore the previous version
→ create a PIXIE handoff packet
→ preview
→ read back the result
```

### Required safety checks

- no approved state without explicit approval;
- no publish from a draft;
- no evidence-free PASS;
- no silent source overwrite;
- no duplicate external mutation on retry;
- unknowns remain visible;
- restore preserves stable IDs and provenance.

## 13. Suggested implementation order

1. Add a versioned UI scene schema and validators.
2. Add frame, node, parent/child, and selection operations.
3. Add SVG-backed rendering and basic export.
4. Add layout primitives: stack, gap, padding, align, hug, fill.
5. Add inspect panel data contract.
6. Add snapshot, diff, and restore.
7. Add simple prototype transitions.
8. Add component/variant and token registries.
9. Add approved-design handoff to PIXIE.
10. Add browser preview and readback evidence.

## 14. Research references

- Figma Design overview: https://www.figma.com/design/
- Figma auto-layout guide: https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout
- Figma variants: https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants
- OpenPencil architecture reference: https://openpencil.dev/development/architecture
- SVG-Edit reference implementation: https://github.com/SVG-Edit/svgedit

## 15. Decision

Proceed with the UI Design Lane as a capability inside the existing PIXIE Visual Workbench.

Do not create a Figma clone, a new top-level app, or a second production authority.

The first implementation target is the governed V1 vertical slice: **scene graph → auto-layout → inspect → export → version → PIXIE handoff → preview → readback**.
