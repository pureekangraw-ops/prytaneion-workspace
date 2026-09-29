import test from "node:test";
import assert from "node:assert/strict";
import { issueStandardMissionTicket, prepareStandardMissionTicket } from "../go-hub-mission-card.mjs";

test("standard card issues without redundant GO confirmation", () => {
  const draft = prepareStandardMissionTicket({
    work:{ workId:"WORK-X", checkpointId:"CP-WORK-X", workType:"NORMAL", requestedDestinations:["factory"], toolAccess:["go_hub_factory_v4"] },
    toolAccess:["go_hub_factory_v4"],
  }, { now:()=>0, randomId:"ABCDEF" });
  const card = issueStandardMissionTicket(draft, { now:()=>1 });
  assert.equal(card.state, "CURRENT");
  assert.equal(card.acceptedBy, "HERMES");
});

test("maintenance authority has one representation", () => {
  const draft = prepareStandardMissionTicket({
    work:{ workId:"WORK-M", checkpointId:"CP-WORK-M", workType:"MAINTENANCE", requestedDestinations:["maintenance"] },
  }, { now:()=>0 });
  assert.equal(draft.access_scope, "MAINTENANCE");
  assert.deepEqual(draft.tool_access, []);
});
