"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const serviceUrl = new URL("../go-hub-deployment-provenance.mjs", import.meta.url);

test("receipt corroborates exact live deployment, every version, and workflow head", async () => {
  const { verifyDeploymentReceipt } = await import(serviceUrl);
  const live = { id:"dep-1", versions:[{ versionId:"version-a", percentage:75 }, { versionId:"version-b", percentage:25 }] };
  const receipt = { repository:"pureekangraw-ops/standard-", worker:"go-hub", workflowRunId:123, sourceSha:"a".repeat(40),
    deploymentId:"dep-1", versions:[{ versionId:"version-a", percentage:75 }, { versionId:"version-b", percentage:25 }] };
  assert.equal(verifyDeploymentReceipt({ receipt, deployment:live, run:{ id:123, head_sha:"a".repeat(40), name:"GO Hub Deploy" } }).status, "VERIFIED");
  assert.equal(verifyDeploymentReceipt({ receipt, deployment:{ ...live, versions:[live.versions[0]] }, run:{ id:123, head_sha:"a".repeat(40), name:"GO Hub Deploy" } }).status, "UNKNOWN");
  assert.equal(verifyDeploymentReceipt({ receipt, deployment:live, run:{ id:123, head_sha:"b".repeat(40), name:"GO Hub Deploy" } }).status, "UNKNOWN");
  assert.equal(verifyDeploymentReceipt({ receipt:{ ...receipt, deploymentId:"dep-other" }, deployment:live, run:{ id:123, head_sha:"a".repeat(40), name:"GO Hub Deploy" } }).status, "UNKNOWN");
});

test("receipt reader accepts only matching artifact and workflow identity", async () => {
  const { createDeploymentProvenanceReader } = await import(serviceUrl);
  const sha = "a".repeat(40);
  const receipt = { repository:"pureekangraw-ops/standard-", worker:"go-hub", workflowRunId:123, sourceSha:sha,
    deploymentId:"dep-1", versions:[{ versionId:"v-1", percentage:100 }] };
  const fetchImpl = async url => {
    const path = String(url);
    if (path.endsWith("/actions/artifacts?per_page=100")) return new Response(JSON.stringify({ artifacts:[
      { id:42, name:"go-hub-deployment-receipt-123", size_in_bytes:500, expired:false, workflow_run:{id:123} },
    ] }));
    if (path.endsWith("/actions/runs/123")) return new Response(JSON.stringify({ id:123, head_sha:sha, name:"GO Hub Deploy" }));
    if (path.endsWith("/actions/artifacts/42/zip")) return new Response(new Uint8Array([1,2,3]));
    throw new Error("unexpected URL " + path);
  };
  const reader = createDeploymentProvenanceReader({ fetchImpl, token:"token", decodeArchive:async () => JSON.stringify(receipt) });
  const proof = await reader.read({ deployment:{ id:"dep-1", versions:[{versionId:"v-1",percentage:100}] } });
  assert.equal(proof.status, "VERIFIED");
  assert.equal(proof.sourceSha, sha);
  assert.equal(proof.evidenceRef, "github://pureekangraw-ops/standard-/actions/runs/123/artifacts/42");
});
