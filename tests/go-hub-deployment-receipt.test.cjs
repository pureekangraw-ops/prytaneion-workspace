"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

async function mod() { return import("../scripts/record-cloudflare-deployment.mjs"); }

test("deployment receipt binds a unique Cloudflare deployment and version to checked-out SHA", async () => {
  const { makeDeploymentReceipt } = await mod();
  const receipt = makeDeploymentReceipt({
    before:[{ id:"older" }],
    after:[{ id:"new-dep", versions:[{ version_id:"version-1", percentage:100 }] }, { id:"older" }],
    repository:"pureekangraw-ops/prytaneion-workspace",
    worker:"go-hub",
    sourceSha:"a".repeat(40),
    workflowRunId:123,
  });
  assert.deepEqual(receipt, {
    repository:"pureekangraw-ops/prytaneion-workspace",
    worker:"go-hub",
    sourceSha:"a".repeat(40),
    workflowRunId:123,
    deploymentId:"new-dep",
    versions:[{ versionId:"version-1", percentage:100 }],
  });
});

test("deployment receipt fails closed when deployment identity is absent or ambiguous", async () => {
  const { makeDeploymentReceipt } = await mod();
  const input = { repository:"pureekangraw-ops/prytaneion-workspace", worker:"go-hub", sourceSha:"a".repeat(40), workflowRunId:123 };
  assert.throws(() => makeDeploymentReceipt({ ...input, before:[], after:[] }), /DEPLOYMENT_ID_UNAVAILABLE/);
  assert.throws(() => makeDeploymentReceipt({ ...input, before:[], after:[{id:"a"},{id:"b"}] }), /DEPLOYMENT_ID_AMBIGUOUS/);
  assert.throws(() => makeDeploymentReceipt({ ...input, before:[], after:[{id:"a",versions:[]}] }), /DEPLOYMENT_VERSION_UNAVAILABLE/);
});

test("deployment listing accepts both Cloudflare API result shapes", async () => {
  const { parseDeploymentList } = await mod();
  const deployments = [{ id:"dep-1", versions:[{ version_id:"v-1", percentage:100 }] }];
  assert.deepEqual(parseDeploymentList({ success:true, result:deployments }), deployments);
  assert.deepEqual(parseDeploymentList({ success:true, result:{ deployments } }), deployments);
  assert.throws(() => parseDeploymentList({ success:true, result:null }), /DEPLOYMENT_LIST_UNAVAILABLE/);
});

test("snapshot tolerates older history pages but rejects a lost observation window", async () => {
  const { makeDeploymentReceipt, parseDeploymentList } = await mod();
  const entries = [{ id:"older" }];
  assert.deepEqual(parseDeploymentList({ success:true, result:{ deployments:entries }, result_info:{ page:1, total_pages:9 } }), entries);
  const input = { repository:"pureekangraw-ops/prytaneion-workspace", worker:"go-hub", sourceSha:"a".repeat(40), workflowRunId:123 };
  assert.throws(() => makeDeploymentReceipt({ ...input, before:[{ id:"older" }], after:[{ id:"new", versions:[{version_id:"v",percentage:100}]}] }), /DEPLOYMENT_SNAPSHOT_WINDOW_LOST/);
});


test("repository identity accepts the current workflow repository and rejects malformed values", async () => {
  const { normalizeRepository } = await mod();
  assert.equal(normalizeRepository("pureekangraw-ops/prytaneion-workspace"), "pureekangraw-ops/prytaneion-workspace");
  assert.throws(() => normalizeRepository(""), /REPOSITORY_INVALID/);
  assert.throws(() => normalizeRepository("not-a-repository"), /REPOSITORY_INVALID/);
});
