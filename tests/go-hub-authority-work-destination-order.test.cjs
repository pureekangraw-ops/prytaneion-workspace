"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const workerUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-factory-mcp-worker.mjs")).href;

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{ "content-type":"application/json; charset=utf-8" },
  });
}

test("governed mutation keeps granted tool authority when Centre has not registered the Work yet", async () => {
  const { createGovernedMutationRunner } = await import(workerUrl + "?authority-work-destination=" + Date.now());
  const audit = [];
  let executed = null;

  const centreLive = {
    async action(input) {
      assert.equal(input.action, "v4_inspect");
      return response({ code:"CENTRE_WORK_NOT_FOUND" }, 404);
    },
  };
  const globalAudit = {
    async append(event) {
      audit.push(event);
      return response({ ok:true });
    },
  };

  const runner = createGovernedMutationRunner({ centreLive, globalAudit });
  const result = await runner("github.put_file", {
    workContext:{
      workId:"WORK-OLYMPUS-SYSTEM-20260929-001",
      checkpointId:"CP-WORK-OLYMPUS-SYSTEM-20260929-001",
      task:"Upload completed OLYMPUS system",
      requestedResult:"Commit files and prepare a PR",
      lensReference:"GO",
    },
  }, async input => {
    executed = structuredClone(input);
    return response({ ok:true, written:true });
  });

  assert.equal(result.status, 200);
  assert.ok(executed, "tool executor must run after an unregistered Work discovery miss");
  assert.equal(executed.workContext.workId, "WORK-OLYMPUS-SYSTEM-20260929-001");
  assert.equal(executed.workContext.checkpointId, "CP-WORK-OLYMPUS-SYSTEM-20260929-001");
  assert.equal(executed.workContext.task, "Upload completed OLYMPUS system");
  assert.equal(executed.workContext.requestedResult, "Commit files and prepare a PR");
  assert.equal(executed.workContext.destination, "destination://factory");
  assert.equal(audit.length, 2);
  assert.equal(audit[0].event.type, "TOOL_MUTATION_INTENT");
  assert.equal(audit[1].event.type, "TOOL_MUTATION_RESULT");
});

test("governed mutation still enforces active ownership when Centre has a governed Work", async () => {
  const { createGovernedMutationRunner } = await import(workerUrl + "?authority-work-destination-owner=" + Date.now());
  let executed = false;

  const centreLive = {
    async action() {
      return response({
        ok:true,
        v4:true,
        workId:"WORK-1",
        checkpointId:"CP-WORK-1",
        returnAddress:"CP-WORK-1",
        work:{ workId:"WORK-1", checkpointId:"CP-WORK-1", workType:"NORMAL" },
        ownership:{ enforced:true, active:false, ownerId:"GO", leaseId:"LEASE-1", revision:1 },
      });
    },
  };
  const globalAudit = {
    async append() {
      return response({ ok:true });
    },
  };

  const runner = createGovernedMutationRunner({ centreLive, globalAudit });
  const result = await runner("github.put_file", {
    workContext:{ workId:"WORK-1", checkpointId:"CP-WORK-1" },
  }, async () => {
    executed = true;
    return response({ ok:true });
  });

  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, "CENTRE_WORK_LEASE_INACTIVE");
  assert.equal(executed, false);
});
