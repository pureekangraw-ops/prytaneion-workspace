const test = require("node:test");
const assert = require("node:assert/strict");

async function mod() { return import("../go-hub-control-room.js"); }

test("Control Room reports Centre ACTIVE versus Project IDLE as a conflict", async () => {
  const { compareCentreProjectStatus } = await mod();
  const result = compareCentreProjectStatus({ centreStatus: "ON PROCESS", projectStatus: "IDLE" });
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.reason, "CENTRE_ACTIVE_PROJECT_IDLE");
});

test("Control Room classifies smoke residue without overwriting Board truth", async () => {
  const { classifyBoardResidue } = await mod();
  const result = classifyBoardResidue({ smokeResidue: true, updatedAt: "2026-09-20T00:00:00.000Z", evidenceRef: "board://550" }, { now: Date.parse("2026-09-25T00:00:00.000Z") });
  assert.equal(result.status, "STALE");
  assert.equal(result.classification, "STALE_PROJECTION_RESIDUE");
  assert.equal(result.evidenceRef, "board://550");
});

test("Control Room preserves UNKNOWN when GitHub to Cloudflare exact provenance is absent", async () => {
  const { proveDeploymentProvenance } = await mod();
  const result = proveDeploymentProvenance({ githubSha: "abc123", cloudflareDeployment: { id: "dep-1" } });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "EXACT_SHA_LINKAGE_UNAVAILABLE");
});

test("Control Room proves exact deployment provenance only on an exact SHA match", async () => {
  const { proveDeploymentProvenance } = await mod();
  assert.equal(proveDeploymentProvenance({ githubSha: "abc123", cloudflareSha: "abc123" }).status, "VERIFIED");
  assert.equal(proveDeploymentProvenance({ githubSha: "abc123", cloudflareSha: "def456" }).status, "MISMATCH");
});

test("GO Control Room is GO-only and exposes only available controls", async () => {
  const { createGoControlRoom } = await mod();
  const work = { workId: "W-1", checkpointId: "CP-1", status: "ON PROCESS", holder: "LIGHT" };
  const room = createGoControlRoom({ work, actor: "GO", capabilities: [
    { id: "read-board", available: true },
    { id: "deploy", available: false },
  ] });
  assert.equal(room.room, "GO_CONTROL_ROOM");
  assert.deepEqual(room.controls.map(item => item.id), ["read-board"]);
  assert.throws(() => createGoControlRoom({ work, actor: "LIGHT" }), /GO_ONLY/);
});


test("Control Room distinguishes exposed, configured, authenticated and live tool reality", async () => {
  const { normalizeToolReality, correlateControlRoomTruth } = await mod();
  const reality = normalizeToolReality({
    github:{ exposed:true, configured:true, authenticated:true, status:"LIVE", evidenceRef:"github://repo" },
    notion:{ exposed:true, configured:true, authenticated:false, authRequired:true },
    pixie:{ exposed:true, configured:false },
    browser:{ exposed:true, configured:true, authenticated:true, status:"STALE" },
  });
  assert.equal(reality.github.status,"LIVE");
  assert.equal(reality.notion.status,"AUTH_REQUIRED");
  assert.equal(reality.pixie.status,"NOT_CONFIGURED");
  assert.equal(reality.browser.status,"STALE");
  assert.deepEqual(reality.notion.response,{ owner:"GO", action:"AUTHORIZE" });
  assert.deepEqual(reality.browser.response,{ owner:"SOURCE_OWNER", action:"REFRESH" });
  const room=correlateControlRoomTruth({ toolReality:{ pixie:{exposed:true,configured:false} } });
  assert.equal(room.toolReality.pixie.status,"NOT_CONFIGURED");
});


test("Control Room exposes one read-only Reality Surface without becoming a second truth source", async () => {
  const { createGoControlRoom } = await mod();
  const work = { workId:"W-REALITY", checkpointId:"CP-REALITY", status:"ON PROCESS", holder:"GO" };
  const room = createGoControlRoom({
    work,
    actor:"GO",
    observations:{
      centre:{ status:"ON PROCESS" },
      projectStatus:{ status:"ON PROCESS" },
      board:{ updatedAt:"2026-09-30T00:30:00.000Z" },
      github:{ sha:"abc123", status:"LIVE" },
      factory:{ status:"LIVE" },
      cloudflare:{ sha:"abc123", status:"LIVE" },
      toolReality:{
        github:{ exposed:true, configured:true, authenticated:true, status:"LIVE", evidenceRef:"github://repo" },
        notion:{ exposed:true, configured:true, authenticated:false, authRequired:true },
      },
    },
    capabilities:[{ id:"read-current", label:"Read current", available:true, mode:"READ" }],
  });
  assert.equal(room.realitySurface.kind, "GO_HUB_REALITY_SURFACE");
  assert.equal(room.realitySurface.mode, "READ_ONLY");
  assert.equal(room.realitySurface.overall, "LIVE");
  assert.equal(room.realitySurface.tools.find(item => item.tool === "github").status, "LIVE");
  assert.equal(room.realitySurface.tools.find(item => item.tool === "notion").status, "AUTH_REQUIRED");
  assert.equal(room.realitySurface.attention.some(item => item.tool === "notion"), true);
  assert.deepEqual(room.realitySurface.controls.map(item => item.id), ["read-current"]);
});

test("CURRENT exposure surface summarizes the live MCP contract instead of making GO inspect the whole tool list", async () => {
  const { AGENT_MISSION_ACTIONS, readCurrentAgentMissionExposure } = await mod();
  const currentMission = {
    name:"go_hub_agent_mission",
    inputSchema:{
      type:"object",
      required:["action"],
      properties:{ action:{ type:"string", enum:[...AGENT_MISSION_ACTIONS] } },
    },
    annotations:{ readOnlyHint:false, destructiveHint:false },
  };
  const exposure = readCurrentAgentMissionExposure({
    listTools:() => [
      currentMission,
      { name:"go_hub_read_file", annotations:{ readOnlyHint:true, destructiveHint:false } },
      { name:"go_hub_merge_pull_request", annotations:{ readOnlyHint:false, destructiveHint:true } },
    ],
    now:() => "2026-09-30T01:00:00.000+07:00",
  });
  assert.equal(exposure.status, "CURRENT");
  assert.equal(exposure.surface.kind, "GO_HUB_CURRENT_EXPOSURE_SURFACE");
  assert.equal(exposure.surface.status, "CURRENT");
  assert.deepEqual(exposure.surface.counts, { total:3, readOnly:1, mutable:2, destructive:1 });
  assert.equal(exposure.surface.agentMission.actions.includes("inspect"), true);
});
