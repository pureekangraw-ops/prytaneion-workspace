"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.resolve(__dirname, "../go-hub-centre-v4.js")).href;

test("Centre preserves lineage and only derives a New Work from COMPLETE", async () => {
  const api = await import(url + "?lineage=" + Date.now());
  const completed = api.createWorkRecord({
    workId:"WORK-COMPLETE-1",
    name:"Original",
    command:"Original",
    expectedResult:"original result",
    workType:"NORMAL",
  });
  const active = api.claimWork(completed, { actor:"GO" });
  const complete = api.returnWork(active, { actor:"GO", status:"COMPLETE", evidence:[{ ref:"evidence://complete" }] });
  const derived = api.createDerivedWork(complete, {
    workId:"WORK-DERIVED-1",
    name:"New intent",
    command:"New intent",
    expectedResult:"new result",
    workType:"NORMAL",
    newIntent:true,
    sourceWorkId:"WORK-COMPLETE-1",
    lineage:{ relatedTo:["WORK-RELATED-1"] },
  });
  assert.equal(derived.lineage.derivedFrom, "WORK-COMPLETE-1");
  assert.deepEqual(derived.lineage.relatedTo, ["WORK-RELATED-1"]);
  assert.throws(() => api.createDerivedWork(complete, {
    workId:"WORK-BAD",
    name:"Same intent",
    command:"Same intent",
    expectedResult:"original result",
    workType:"NORMAL",
    sourceWorkId:"WORK-COMPLETE-1",
  }), /new intent/);
  assert.throws(() => api.createDerivedWork(complete, {
    workId:"WORK-BAD",
    name:"Wrong source",
    command:"Wrong source",
    expectedResult:"new result",
    workType:"NORMAL",
    newIntent:true,
    sourceWorkId:"WORK-OTHER",
  }), /source mismatch/);
});
