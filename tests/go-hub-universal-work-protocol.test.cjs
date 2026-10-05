const test = require("node:test");
const assert = require("node:assert/strict");

test("Universal Work Protocol exposes shared events, statuses, actors, and invariants", async () => {
  const protocol = await import("../go-hub-universal-work-protocol.mjs");
  assert.deepEqual(protocol.UNIVERSAL_WORK_EVENTS, [
    "CREATE", "RECEIVED", "RESUME", "EXECUTE", "RETURN", "VERIFY", "CLOSE",
  ]);
  assert.ok(protocol.UNIVERSAL_WORK_ACTORS.includes("PIXIE"));
  assert.ok(protocol.UNIVERSAL_WORK_ACTORS.includes("LIGHT"));
  assert.ok(protocol.UNIVERSAL_WORK_ACTORS.includes("SPECTRUM_PRIME"));
  assert.ok(protocol.UNIVERSAL_WORK_ACTORS.includes("OLYMPUS"));
  assert.equal(protocol.UNIVERSAL_WORK_ACTORS.includes("SPECTRUM"), false);
  assert.ok(protocol.UNIVERSAL_WORK_STATUSES.includes("WAIT_VERIFY"));
  assert.ok(protocol.universalWorkProtocolOverview().invariants.includes("RETURN_IS_NOT_COMPLETE"));
});

test("Work Envelope preserves identity, ownership, and separate current status", async () => {
  const { createWorkEnvelope } = await import("../go-hub-universal-work-protocol.mjs");
  const envelope = createWorkEnvelope({
    workId: "WORK-1",
    checkpointId: "CP-1",
    requestedResult: "shared protocol",
    scope: "core contract",
    owner: "CENTRE",
    origin: "GO",
    target: "PIXIE",
    currentState: "OPEN",
  });

  assert.deepEqual(envelope.identity, { workId: "WORK-1", checkpointId: "CP-1" });
  assert.deepEqual(envelope.ownership, { owner: "CENTRE", origin: "GO", target: "PIXIE" });
  assert.equal(envelope.lifecycle.currentState, "OPEN");
  assert.equal(envelope.lifecycle.lastEvent, null);
});

test("actor adapters preserve source vocabulary while mapping to shared lifecycle events", async () => {
  const { adaptActorAction } = await import("../go-hub-universal-work-protocol.mjs");
  assert.equal(adaptActorAction({ actor: "COUNTER", action: "pickup" }).event, "RECEIVED");
  assert.equal(adaptActorAction({ actor: "LIGHT", action: "resume" }).event, "RESUME");
  assert.equal(adaptActorAction({ actor: "PIXIE", action: "result packet" }).event, "RETURN");
  assert.equal(adaptActorAction({ actor: "GO", action: "verification" }).event, "VERIFY");
  assert.equal(adaptActorAction({ actor: "HERMES", action: "return_tablet" }).event, "RETURN");
  const spectrum = adaptActorAction({ actor: "SPECTRUM", action: "status brief" });
  assert.equal(spectrum.actor, "SPECTRUM_PRIME");
  assert.equal(spectrum.event, "RETURN");
  assert.equal(adaptActorAction({ actor: "OLYMPUS", action: "verify" }).event, "VERIFY");
  assert.throws(
    () => adaptActorAction({ actor: "OLYMPUS", action: "execute" }),
    /UNIVERSAL_WORK_ACTOR_ACTION_UNKNOWN:OLYMPUS:execute/,
  );

  const mapped = adaptActorAction({ actor: "LIGHT", action: "resume", sourceEvent: "LIGHT_RESUME" });
  assert.equal(mapped.sourceEvent, "LIGHT_RESUME");
  assert.equal(mapped.actorAction, "resume");
});

test("lifecycle event is separate from Work status", async () => {
  const { createWorkEnvelope, applyActorAction } = await import("../go-hub-universal-work-protocol.mjs");
  const initial = createWorkEnvelope({
    workId: "WORK-2",
    checkpointId: "CP-2",
    requestedResult: "verify separation",
    owner: "CENTRE",
    origin: "GO",
    target: "LIGHT",
  });
  const received = applyActorAction(initial, {
    actor: "COUNTER",
    action: "pickup",
    nextStatus: "IN_PROGRESS",
  });
  const returned = applyActorAction(received, {
    actor: "LIGHT",
    action: "return",
    nextStatus: "WAIT_VERIFY",
    evidenceRefs: ["evidence://1"],
  });
  const verified = applyActorAction(returned, {
    actor: "GO",
    action: "verification",
    nextStatus: "VERIFIED",
  });

  assert.equal(received.lifecycle.lastEvent.event, "RECEIVED");
  assert.equal(returned.lifecycle.lastEvent.event, "RETURN");
  assert.equal(returned.lifecycle.currentState, "WAIT_VERIFY");
  assert.equal(verified.lifecycle.lastEvent.event, "VERIFY");
  assert.equal(verified.lifecycle.currentState, "VERIFIED");
  assert.equal(verified.lifecycle.history.length, 3);
});

test("handoff and resume preserve identity and do not become close", async () => {
  const { createWorkEnvelope, applyActorAction } = await import("../go-hub-universal-work-protocol.mjs");
  const envelope = createWorkEnvelope({
    workId: "WORK-3",
    checkpointId: "CP-3",
    requestedResult: "resume same work",
    owner: "CENTRE",
    origin: "GO",
    target: "PIXIE",
  });
  const resumed = applyActorAction(
    applyActorAction(envelope, { actor: "PIXIE", action: "receive" }),
    { actor: "PIXIE", action: "resume", nextStatus: "IN_PROGRESS" },
  );

  assert.deepEqual(resumed.identity, envelope.identity);
  assert.deepEqual(resumed.ownership, envelope.ownership);
  assert.equal(resumed.lifecycle.lastEvent.event, "RESUME");
  assert.notEqual(resumed.lifecycle.currentState, "CLOSED");
});

test("invalid skips and identity mismatches are rejected", async () => {
  const { createWorkEnvelope, applyActorAction } = await import("../go-hub-universal-work-protocol.mjs");
  const envelope = createWorkEnvelope({
    workId: "WORK-4",
    checkpointId: "CP-4",
    requestedResult: "reject invalid transition",
  });
  assert.throws(
    () => applyActorAction(envelope, { actor: "PIXIE", action: "execute" }),
    /UNIVERSAL_WORK_TRANSITION_INVALID/,
  );
  assert.throws(
    () => applyActorAction(envelope, {
      actor: "GO",
      action: "receive",
      workId: "WORK-OTHER",
      checkpointId: "CP-4",
    }),
    /UNIVERSAL_WORK_IDENTITY_MISMATCH/,
  );
});
