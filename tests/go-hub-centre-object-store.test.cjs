"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const {createHash}=require("node:crypto");

const moduleUrl=pathToFileURL(path.resolve(__dirname,"../go-hub-centre-object-store.mjs")).href;

function mockBucket(){
  const map=new Map();
  return {
    async put(key,body,options={}){
      const bytes=body instanceof Uint8Array?body:new Uint8Array(body);
      const record={
        key,
        body:new Uint8Array(bytes),
        size:bytes.byteLength,
        etag:"etag-"+bytes.byteLength,
        uploaded:new Date("2026-10-03T00:00:00.000Z"),
        httpMetadata:options.httpMetadata||{},
        customMetadata:options.customMetadata||{},
      };
      map.set(key,record);
      return record;
    },
    async head(key){return map.get(key)||null},
    async get(key){
      const record=map.get(key);
      if(!record)return null;
      return {...record,body:new Response(record.body).body};
    },
    map,
  };
}

test("Centre R2 object store persists bytes and returns stable metadata",async()=>{
  const {createCentreObjectStore}=await import(moduleUrl+"?e2e="+Date.now());
  const bucket=mockBucket();
  const store=createCentreObjectStore({bucket});
  const body=new TextEncoder().encode("centre-r2-test");
  const expectedHash=createHash("sha256").update(body).digest("hex");

  const written=await store.put({
    workId:"WORK-1",
    checkpointId:"CP-1",
    objectId:"brief.json",
    body,
    contentType:"application/json",
  });

  assert.equal(written.objectKey,"centre/WORK-1/CP-1/brief.json");
  assert.equal(written.sha256,expectedHash);
  assert.equal(written.size,body.byteLength);
  assert.equal(written.contentType,"application/json");

  const head=await store.head({workId:"WORK-1",checkpointId:"CP-1",objectId:"brief.json"});
  assert.equal(head.sha256,expectedHash);
  assert.equal(head.workId,"WORK-1");
  assert.equal(head.checkpointId,"CP-1");

  const fetched=await store.get({workId:"WORK-1",checkpointId:"CP-1",objectId:"brief.json"});
  assert.equal(await new Response(fetched.body).text(),"centre-r2-test");
  assert.equal(fetched.head.objectKey,written.objectKey);
});

test("Centre R2 object store fails closed without bucket binding",async()=>{
  const {createCentreObjectStore}=await import(moduleUrl+"?closed="+Date.now());
  const store=createCentreObjectStore();
  await assert.rejects(
    ()=>store.put({workId:"W",checkpointId:"C",objectId:"x",body:"x"}),
    /CENTRE_OBJECT_STORE_NOT_CONFIGURED/
  );
});
