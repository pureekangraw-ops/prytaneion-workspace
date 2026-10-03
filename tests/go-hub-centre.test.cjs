"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-centre.js")).href;
const load = () => import(`${moduleUrl}?${Date.now()}-${Math.random()}`);

test("Centre creates one stable checkpoint identity", async () => {
  const { createCheckpoint, CENTRE_STATES } = await load();
  const work = createCheckpoint({
    checkpointId: "CENTRE-001",
    workId: "WORK-A",
    createdAt: "2026-09-14T15:00:00.000Z",
  });
  assert.equal(work.status, CENTRE_STATES.ARRIVED);
  assert.equal(work.checkpointId, "CENTRE-001");
  assert.equal(work.workId, "WORK-A");
  assert.equal(Object.isFrozen(work), true);
});

test("unclear intake waits and can resume without replacing identity", async () => {
  const { createCheckpoint, intakeTask, resumeIntake, CENTRE_STATES } = await load();
  const arrived = createCheckpoint({ checkpointId: "CENTRE-001", workId: "WORK-A" });
  const waiting = intakeTask(arrived, { task: "Task A", authority: "BIG" });
  assert.equal(waiting.status, CENTRE_STATES.WAIT);
  const ready = resumeIntake(waiting, { requestedResult: "Return verified result" });
  assert.equal(ready.status, CENTRE_STATES.READY);
  assert.equal(ready.checkpointId, arrived.checkpointId);
  assert.equal(ready.workId, arrived.workId);
});

test("Persona changes working view without changing task truth", async () => {
  const { createCheckpoint, intakeTask, fitPersona } = await load();
  const ready = intakeTask(
    createCheckpoint({ checkpointId: "CENTRE-001", workId: "WORK-A" }),
    { task: "Task A", requestedResult: "Result A", authority: "BIG" },
  );
  const fitted = fitPersona(ready, {
    personaId: "PERSONA-CRYSTALLIZE",
    personaReference: "persona://crystallize",
    workingView: "Find the smallest testable truth",
  });
  assert.equal(fitted.task, "Task A");
  assert.equal(fitted.requestedResult, "Result A");
  assert.equal(fitted.persona.personaReference, "persona://crystallize");
});

test("handoff uses an abstract destination and the original checkpoint as return address", async () => {
  const { createCheckpoint, intakeTask, fitPersona, createHandoff, CENTRE_STATES } = await load();
  const fitted = fitPersona(
    intakeTask(
      createCheckpoint({ checkpointId: "CENTRE-001", workId: "WORK-A" }),
      { task: "Task A", requestedResult: "Result A", authority: "BIG" },
    ),
    { personaId: "PERSONA-1", personaReference: "persona://1", workingView: "View A" },
  );
  const { work, envelope } = createHandoff(fitted, { destination: "destination://factory" });
  assert.equal(work.status, CENTRE_STATES.AWAY);
  assert.equal(envelope.destination, "destination://factory");
  assert.equal(envelope.returnAddress, "CENTRE-001");
  assert.equal(envelope.workId, "WORK-A");
});

test("Reality Test: Work A returns to Centre 001 and does not create Centre 002", async () => {
  const {
    createCheckpoint, intakeTask, fitPersona, createHandoff,
    createTestDestinationAdapter, receiveReturn, CENTRE_STATES,
  } = await load();

  const checkpoint = createCheckpoint({
    checkpointId: "CENTRE-001",
    workId: "WORK-A",
    createdAt: "2026-09-14T15:00:00.000Z",
  });
  const ready = fitPersona(
    intakeTask(checkpoint, {
      task: "Task A",
      requestedResult: "Return the same work identity",
      authority: "BIG",
    }),
    {
      personaId: "PERSONA-1",
      personaReference: "persona://first-fit",
      workingView: "Track identity and return address",
    },
  );
  const sent = createHandoff(ready, { destination: "test://destination" });
  const destination = createTestDestinationAdapter(() => ({ outcome: "test-only" }));
  const returned = receiveReturn(sent.work, destination.accept(sent.envelope));

  assert.equal(returned.status, CENTRE_STATES.RETURNED);
  assert.equal(returned.workId, "WORK-A");
  assert.equal(returned.checkpointId, "CENTRE-001");
  assert.equal(returned.handoff.returnAddress, "CENTRE-001");
  assert.deepEqual(returned.returnedPayload, { outcome: "test-only" });
  assert.equal(returned.mimirHousekeeping.envelope.workId, "WORK-A");
  assert.equal(returned.mimirHousekeeping.envelope.checkpointId, "CENTRE-001");
  assert.equal(returned.mimirHousekeeping.envelope.items[0].kind, "RESULT");
  assert.equal(returned.mimirHousekeeping.plan.writePerformed, false);
  assert.equal(returned.mimirHousekeeping.plan.sourceMutationAllowed, false);
});

test("return receiver rejects mismatched work or checkpoint identity", async () => {
  const { createCheckpoint, intakeTask, fitPersona, createHandoff, receiveReturn } = await load();
  const fitted = fitPersona(
    intakeTask(
      createCheckpoint({ checkpointId: "CENTRE-001", workId: "WORK-A" }),
      { task: "Task A", requestedResult: "Result A", authority: "BIG" },
    ),
    { personaId: "PERSONA-1", personaReference: "persona://1", workingView: "View A" },
  );
  const sent = createHandoff(fitted, { destination: "test://destination" });
  assert.throws(
    () => receiveReturn(sent.work, { workId: "WORK-B", checkpointId: "CENTRE-001" }),
    /Work ID/,
  );
  assert.throws(
    () => receiveReturn(sent.work, { workId: "WORK-A", checkpointId: "CENTRE-002" }),
    /Checkpoint ID/,
  );
});


test("all GO work leaves and returns through the same Centre passage", async () => {
  const { createCentrePassage, createTestDestinationAdapter, CENTRE_STATES } = await load();
  const centre = createCentrePassage();

  const arrived = centre.enter({ checkpointId: "CENTRE-001", workId: "WORK-A" });
  const reviewed = centre.review(arrived, {
    task: "Construct through Factory",
    requestedResult: "Verified construction result",
    authority: "BIG",
  });

  assert.throws(
    () => centre.leave(reviewed, { destination: "destination://factory" }),
    /fitted Persona/,
    "GO cannot bypass the Centre fitting step",
  );

  const fitted = centre.fit(reviewed, {
    personaId: "PERSONA-FIT",
    personaReference: "persona://fit",
    workingView: "Build only the requested result",
  });
  const outbound = centre.leave(fitted, { destination: "destination://factory" });
  const factory = createTestDestinationAdapter(() => ({ result: "verified" }));
  const returned = centre.return(outbound.work, factory.accept(outbound.envelope));

  assert.equal(returned.status, CENTRE_STATES.RETURNED);
  assert.equal(returned.checkpointId, arrived.checkpointId);
  assert.equal(returned.workId, arrived.workId);
  assert.equal(returned.handoff.returnAddress, arrived.checkpointId);
});

test("the Centre passage rejects a second entry while work is already in flight", async () => {
  const { createCentrePassage } = await load();
  const centre = createCentrePassage();
  const reviewed = centre.review(
    centre.enter({ checkpointId: "CENTRE-001", workId: "WORK-A" }),
    { task: "Task A", requestedResult: "Result A", authority: "BIG" },
  );
  const fitted = centre.fit(reviewed, {
    personaId: "PERSONA-1",
    personaReference: "persona://1",
    workingView: "View A",
  });
  const outbound = centre.leave(fitted, { destination: "destination://factory" });

  assert.throws(
    () => centre.review(outbound.work, {
      task: "Replacement task",
      requestedResult: "Replacement result",
      authority: "BIG",
    }),
    /ARRIVED/,
  );
});


test("Centre session restores the exact checkpoint after reload", async () => {
  const nonce = `${Date.now()}-${Math.random()}`;
  const { createCentrePassage, createCentreSession } = await import(`${moduleUrl}?session=${nonce}`);
  const persistenceUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-persistence.js")).href;
  const { createMemoryKeyValueStore, createStatePersistence } = await import(`${persistenceUrl}?session=${nonce}`);
  const persistence = createStatePersistence({
    store: createMemoryKeyValueStore(),
    key: "active-checkpoint",
  });
  const centre = createCentrePassage();
  const session = createCentreSession({
    persistence,
    passage: centre,
    initial: { checkpointId: "CENTRE-001", workId: "WORK-A" },
  });

  const arrived = await session.load();
  const reviewed = centre.review(arrived, {
    task: "Task A",
    requestedResult: "Result A",
    authority: "BIG",
  });
  const fitted = centre.fit(reviewed, {
    personaId: "PERSONA-1",
    personaReference: "persona://1",
    workingView: "View A",
  });
  const away = centre.leave(fitted, { destination: "destination://factory" }).work;
  await session.save(away, "LEAVE_CENTRE");

  const restored = await session.load();
  assert.equal(restored.status, "AWAY");
  assert.equal(restored.workId, "WORK-A");
  assert.equal(restored.checkpointId, "CENTRE-001");
  assert.equal(restored.handoff.returnAddress, "CENTRE-001");
});

test("Destination capability is admitted only by an exact AWAY handoff", async () => {
  const {
    createCentrePassage, admitDestination, createReturnPacket,
  } = await load();
  const centre = createCentrePassage();
  const reviewed = centre.review(
    centre.enter({ checkpointId: "CENTRE-001", workId: "WORK-A" }),
    { task: "Build", requestedResult: "Verified build", authority: "BIG" },
  );
  const capability = { id: "code", status: "ready", run() { return "real method"; } };

  assert.throws(
    () => admitDestination(reviewed, {
      destination: "destination://factory",
      capability,
    }),
    /AWAY/,
  );

  const fitted = centre.fit(reviewed, {
    personaId: "PERSONA-1",
    personaReference: "persona://1",
    workingView: "Build against repository truth",
  });
  const away = centre.leave(fitted, { destination: "destination://factory" }).work;

  assert.throws(
    () => admitDestination(away, {
      destination: "destination://mimir",
      capability,
    }),
    /does not match/,
  );

  const access = admitDestination(away, {
    destination: "destination://factory",
    capability,
  });
  const returned = centre.return(
    away,
    createReturnPacket(access, { status: "verified" }),
  );

  assert.equal(access.capability, capability);
  assert.equal(access.capability.run(), "real method");
  assert.equal(returned.status, "RETURNED");
  assert.equal(returned.checkpointId, "CENTRE-001");
});


test("current Persona fit is first-class and handoff is Persona-only", async () => {
  const { createCentrePassage } = await load();
  const centre = createCentrePassage();
  const reviewed = centre.review(
    centre.enter({ checkpointId: "CENTRE-PERSONA-001", workId: "WORK-PERSONA-A" }),
    { task: "Task Role", requestedResult: "Role result", authority: "BIG" },
  );

  const fitted = centre.fit(reviewed, {
    personaId: "PERSONA-DETECTIVE",
    personaReference: "persona://detective",
    workingView: "Trace the first broken truth",
  });

  assert.equal(fitted.persona.personaReference, "persona://detective");

  const outbound = centre.leave(fitted, { destination: "destination://factory" });
  assert.equal(outbound.envelope.personaReference, "persona://detective");
});


test("explicit Work Target survives Review and Factory handoff without becoming a default", async () => {
  const { createCentrePassage } = await load();
  const centre = createCentrePassage();
  const reviewed = centre.review(
    centre.enter({ checkpointId: "CENTRE-LH", workId: "WORK-LH" }),
    {
      task: "Work on LIGHTHOUSE",
      requestedResult: "Verified LIGHTHOUSE result",
      authority: "BIG",
      targetId: "lighthouse",
    },
  );
  assert.equal(reviewed.targetId, "lighthouse");

  const fitted = centre.fit(reviewed, {
    personaId: "PERSONA-LH",
    personaReference: "persona://lighthouse",
    workingView: "Follow the explicit target",
  });
  const outbound = centre.leave(fitted, {
    destination: "destination://factory",
    targetId: "lighthouse",
  });
  assert.equal(outbound.work.targetId, "lighthouse");
  assert.equal(outbound.envelope.targetId, "lighthouse");
  assert.equal(outbound.envelope.destination, "destination://factory");
});


test("every Centre return automatically passes through MIMIR return housekeeping", async () => {
  const { createCentrePassage, createTestDestinationAdapter } = await load();
  const centre = createCentrePassage();
  let work = centre.enter({ checkpointId: "CENTRE-MIMIR-001", workId: "WORK-MIMIR-A" });
  work = centre.review(work, {
    task: "Build and return evidence",
    requestedResult: "Verified result with artifact",
    authority: "BIG",
  });
  work = centre.fit(work, {
    personaId: "PERSONA-1",
    personaReference: "persona://1",
    workingView: "Return through Centre",
  });
  const outbound = centre.leave(work, { destination: "destination://factory" });
  const destination = createTestDestinationAdapter(() => ({
    status: "PASS",
    evidence: [{ ref: "evidence://1" }],
    artifact: { id: "artifact-1", digest: "sha256:1" },
    refs: { headSha: "abc123" },
    lessons: [{ finding: "keep return identity" }],
  }));
  const returned = centre.return(outbound.work, destination.accept(outbound.envelope));

  assert.deepEqual(
    returned.mimirHousekeeping.envelope.items.map(item => item.kind),
    ["RESULT", "STATUS", "EVIDENCE", "ARTIFACT", "METADATA", "KNOWLEDGE"],
  );
  assert.equal(returned.mimirHousekeeping.plan.report.received, 6);
  assert.equal(returned.mimirHousekeeping.plan.report.store, 6);
  assert.equal(returned.mimirHousekeeping.plan.requiresOwnerApproval, false);
  assert.equal(returned.mimirHousekeeping.plan.writePerformed, false);
});
