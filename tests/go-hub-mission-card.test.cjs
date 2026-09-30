"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-runtime.js")).href;

function cardInput() {
  return {
    workId: "WORK-MISSION-1",
    checkpointId: "CP-MISSION-1",
    jobCode: "JOB-1",
    status: "THIS MUST NOT BE COPIED",
    phase: "THIS MUST NOT BE COPIED",
  };
}

test("Mission Card is a pointer and never carries owner truth", async () => {
  const { createMissionCard } = await import(moduleUrl);
  const card = createMissionCard(cardInput());
  assert.deepEqual(card.workId, "WORK-MISSION-1");
  assert.deepEqual(card.checkpointId, "CP-MISSION-1");
  assert.equal("status" in card, false);
  assert.equal("phase" in card, false);
});

test("Card Counter resolves fresh owner source and projects read-only observations", async () => {
  const { createMissionCard, createCardCounter } = await import(moduleUrl + "?counter=" + Date.now());
  const card = createMissionCard(cardInput());
  const calls = [];
  const counter = createCardCounter({
    resolveWork: async context => {
      calls.push(context);
      return { status: "ON PROCESS", ownerSource: "Centre", sourceRef: "centre://work/1" };
    },
    projections: [
      { source: "CENTRE", read: async ({ fresh }) => ({ status: fresh ? "LIVE" : "UNKNOWN", ownerSource: "Centre", data: { phase: "ON PROCESS" }, sourceRef: "centre://work/1" }) },
      { source: "BOARD", read: async () => ({ status: "LIVE", ownerSource: "Central Board", data: { phase: "DOING" }, sourceRef: "board://work/1" }) },
    ],
  });
  const projection = await counter.tap(card, { lens: "factory" });
  assert.equal(calls[0].fresh, true);
  assert.equal(projection.mutates, false);
  assert.equal(projection.lens, "factory");
  assert.deepEqual(projection.observations.map(item => item.source), ["CENTRE", "BOARD"]);
  assert.equal(projection.card.status, undefined);
});

test("Dressing brief survives missing LIGHT and preserves UNKNOWN", async () => {
  const { createMissionCard, createCardCounter, composeDressingBrief } = await import(moduleUrl + "?brief=" + Date.now());
  const card = createMissionCard(cardInput());
  const counter = createCardCounter({
    resolveWork: async () => ({ status: "ON PROCESS" }),
    projections: [
      { source: "CENTRE", read: async () => ({ status: "LIVE", ownerSource: "Centre", data: { status: "ON PROCESS" }, sourceRef: "centre://1" }) },
      { source: "GITHUB", read: async () => { throw new Error("github unavailable"); } },
    ],
  });
  const projection = await counter.tap(card);
  const brief = composeDressingBrief({ counterProjection: projection });
  assert.equal(brief.light.status, "UNAVAILABLE");
  assert.equal(brief.mutates, false);
  assert.equal(brief.observations.find(item => item.source === "GITHUB").status, "UNKNOWN");
  assert.equal(brief.observations.find(item => item.source === "CENTRE").ownerSource, "Centre");
});

test("1:1 crosscheck and doubt engine emit observations, not verdicts", async () => {
  const { compareOneToOne, createDoubtEngine } = await import(moduleUrl + "?compare=" + Date.now());
  const result = compareOneToOne({
    topic: "Centre status ↔ Board status",
    left: { status: "LIVE", data: "OPEN", ownerSource: "Centre" },
    right: { status: "LIVE", data: "COMPLETE", ownerSource: "Central Board" },
  });
  assert.equal(result.status, "DIFFERENT");
  assert.equal("verdict" in result, false);
  assert.equal(createDoubtEngine([result])[0].label, "WORTH CHECKING");
});

test("Re-brief exposes only changed observations as SINCE LAST BRIEF", async () => {
  const { compareBriefs } = await import(moduleUrl + "?rebrief=" + Date.now());
  const previous = { observations: [{ source: "CENTRE", status: "LIVE", data: { phase: "OPEN" } }] };
  const current = { observations: [{ source: "CENTRE", status: "LIVE", data: { phase: "COMPLETE" } }] };
  const changes = compareBriefs(previous, current);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].label, "SINCE LAST BRIEF");
  assert.equal(changes[0].status, "CHANGED");
});


test("standard HERMES ticket issues directly and preserves BIG confirmation on replacement", async () => {
  const mod = await import("../go-hub-mission-card.mjs");
  const work = {
    workId:"WORK-HERMES-TEST-20260928-001",
    checkpointId:"CP-WORK-HERMES-TEST-20260928-001",
    jobCode:"2809-7P4G",
    requestedDestinations:["hermes"],
  };
  const draft = mod.prepareStandardMissionTicket({ work, destinations:["hermes"], accessScope:"WORK", toolAccess:["go_hub_agent_mission"] }, { now:() => Date.parse("2026-09-28T12:00:00Z") });
  assert.equal(draft.state, "DRAFT");
  const current = mod.issueStandardMissionTicket(draft, { now:() => Date.parse("2026-09-28T12:01:00Z") });
  assert.equal(current.state, "CURRENT");
  assert.equal(current.workId, work.workId);
  assert.equal(current.checkpointId, work.checkpointId);

  const replacementDraft = mod.prepareStandardMissionTicket({
    work,
    destinations:["hermes","factory"],
    reason:"ROUTE_CHANGE",
    accessScope:"WORK",
    toolAccess:["go_hub_agent_mission","go_hub_factory_v4"],
    snapshotKey:current.snapshot_key,
  }, { now:() => Date.parse("2026-09-28T12:02:00Z") });

  assert.deepEqual(current.destinations, ["hermes"]);

  const replaced = mod.replaceStandardMissionTicket(current, replacementDraft, {
    confirmation:"GO_CONFIRMED",
    now:() => Date.parse("2026-09-28T12:03:00Z"),
  });
  assert.deepEqual(replaced.current.destinations, ["hermes","factory"]);
  assert.equal(replaced.current.workId, current.workId);
  assert.equal(replaced.current.checkpointId, current.checkpointId);
  assert.equal(replaced.audit.event, "CARD_REPLACED");
  assert.equal(replaced.audit.reason, "ROUTE_CHANGE");
  assert.match(mod.missionTicketSearchCode(work.workId), /^W[A-Z0-9]{4}$/);
});


test("HERMES access card has only two authorization inputs and WORK gets stable snapshot key", async () => {
  const mod = await import("../go-hub-mission-card.mjs?access=" + Date.now());
  const work = { workId:"WORK-ACCESS-1", checkpointId:"CP-WORK-ACCESS-1", requestedDestinations:["factory"] };
  const draft = mod.prepareStandardMissionTicket({
    work,
    accessScope:"WORK",
    toolAccess:["go_hub_factory_v4","go_hub_read_file"],
    destinations:["factory"],
  }, {
    now:() => Date.parse("2026-09-29T01:00:00Z"),
    randomId:() => "a1b2c3-test",
  });
  assert.equal(draft.access_scope, "WORK");
  assert.deepEqual(draft.tool_access, ["go_hub_factory_v4","go_hub_read_file"]);
  assert.equal(draft.snapshot_key, "SNAP-20260929-A1B2C3");
  const replacement = mod.prepareStandardMissionTicket({
    work,
    accessScope:"WORK",
    toolAccess:["go_hub_factory_v4"],
    destinations:["factory"],
    snapshotKey:draft.snapshot_key,
  });
  assert.equal(replacement.snapshot_key, draft.snapshot_key);
});

test("MAINTENANCE card preserves explicit destination tools and carries no work snapshot key", async () => {
  const mod = await import("../go-hub-mission-card.mjs?maintenance=" + Date.now());
  const draft = mod.prepareStandardMissionTicket({
    work:{ workId:"WORK-MAINT-1", checkpointId:"CP-WORK-MAINT-1", workType:"MAINTENANCE", requestedDestinations:["maintenance"] },
    accessScope:"MAINTENANCE",
    destinations:["maintenance"],
    toolAccess:["go_hub_maintenance"],
  });
  assert.equal(draft.access_scope, "MAINTENANCE");
  assert.deepEqual(draft.tool_access, ["go_hub_maintenance"]);
  assert.equal(draft.snapshot_key, null);
});

test("Mission Card carries stable intent and can record GO acceptance without becoming owner truth", async () => {
  const mod = await import("../go-hub-mission-card.mjs?card-helper=" + Date.now());
  const work = {
    workId:"WORK-CARD-HELPER-1",
    checkpointId:"CP-WORK-CARD-HELPER-1",
    jobCode:"3009-CHLP",
    command:"Inspect GitHub target",
    expectedResult:"Read selected source and return evidence",
    requestedDestinations:["GITHUB"],
  };
  const draft = mod.prepareStandardMissionTicket({
    work,
    accessScope:"WORK",
    destinations:["GITHUB"],
    toolAccess:["go_hub_read_file"],
    context:[{ contextId:"T1", kind:"TARGET", target:"repo", destination:"GITHUB", tool:"go_hub_read_file" }],
    intent:{ mission:"Inspect GitHub target", requestedResult:"Read selected source and return evidence" },
  });
  const card = mod.issueStandardMissionTicket(draft, { acceptedBy:"GO" });
  assert.equal(card.acceptedBy, "GO");
  assert.equal(card.intent.mission, "Inspect GitHub target");
  assert.equal(card.intent.requestedResult, "Read selected source and return evidence");
  assert.equal(card.context[0].destination, "GITHUB");
  assert.equal(card.last_return, null);
  assert.equal("status" in card, false, "Card still must not copy current owner status");
});

test("Work Tablet has its own ID, accepts GO-chosen data, and may start with no tools", async () => {
  const mod = await import("../go-hub-mission-card.mjs?tablet=" + Date.now());
  const work = {
    workId:"WORK-TABLET-1",
    checkpointId:"CP-WORK-TABLET-1",
    jobCode:"3009-TBLT",
    command:"Enter the work",
    expectedResult:"Carry GO-selected work data",
    requestedDestinations:[],
  };
  const draft = mod.prepareStandardMissionTicket({
    work,
    accessScope:"WORK",
    destinations:[],
    toolAccess:[],
    data:{ note:"GO chose this", target:null },
    intent:{ mission:"Enter the work", requestedResult:"Carry GO-selected work data" },
  });
  const tablet = mod.issueStandardMissionTicket(draft, { acceptedBy:"GO" });
  assert.equal(tablet.tabletId, "TABLET:3009-TBLT");
  assert.equal(tablet.cardId, "CARD:3009-TBLT", "legacy Card ID stays internal-compatible during migration");
  assert.deepEqual(tablet.tool_access, []);
  assert.deepEqual(tablet.data, { note:"GO chose this", target:null });
  assert.equal(tablet.acceptedBy, "GO");
});

