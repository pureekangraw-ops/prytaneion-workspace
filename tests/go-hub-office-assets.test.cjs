"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");

const gateUrl=pathToFileURL(path.resolve(__dirname,"../go-hub-office-gate.mjs")).href;

class FakeR2 {
  constructor(){this.objects=new Map()}
  async put(key,bytes,options={}){
    const data=new Uint8Array(bytes);
    this.objects.set(key,{
      key,
      bytes:data,
      size:data.byteLength,
      etag:"etag-"+data.byteLength,
      uploaded:new Date("2026-10-03T00:00:00.000Z"),
      httpMetadata:options.httpMetadata||{},
      customMetadata:options.customMetadata||{},
    });
  }
  async head(key){
    const item=this.objects.get(key);
    if(!item)return null;
    const {bytes,...meta}=item;
    return meta;
  }
  async get(key){
    const item=this.objects.get(key);
    if(!item)return null;
    return {...item,body:item.bytes};
  }
  async list({prefix=""}={}){
    return{
      objects:[...this.objects.values()]
        .filter(item=>item.key.startsWith(prefix))
        .map(({bytes,...meta})=>meta),
      truncated:false,
    };
  }
}

function env(bucket){
  return{
    GOHUB_OFFICE_PASSCODE:"office-secret",
    GOHUB_OFFICE_SESSION_KEY:"0123456789abcdef0123456789abcdef",
    GOHUB_OFFICE_SESSION_EPOCH:"1",
    OFFICE_ASSETS:bucket,
  };
}

async function login(gate,environment){
  const response=await gate.fetch(new Request("https://office.example/office/login",{
    method:"POST",
    headers:{origin:"https://office.example","content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({passcode:"office-secret"}),
  }),environment);
  assert.equal(response.status,303);
  return (response.headers.get("set-cookie")||"").split(";")[0];
}

test("Office R2 assets require session and upload with verified readback",async()=>{
  const{createOfficeGate}=await import(gateUrl+"?assets="+Date.now());
  const gate=createOfficeGate();
  const bucket=new FakeR2();
  const environment=env(bucket);

  const unauth=await gate.fetch(new Request("https://office.example/office/api/assets"),environment);
  assert.equal(unauth.status,401);

  const cookie=await login(gate,environment);
  const data=new FormData();
  data.append("file",new Blob(["png-demo"],{type:"image/png"}),"demo.png");
  data.append("category","visuals");

  const upload=await gate.fetch(new Request("https://office.example/office/api/assets",{
    method:"POST",
    headers:{cookie,origin:"https://office.example"},
    body:data,
  }),environment);
  assert.equal(upload.status,201);
  const uploaded=await upload.json();
  assert.equal(uploaded.ok,true);
  assert.match(uploaded.asset.key,/^office\/visuals\/2026\/10\/03\//);
  assert.equal(uploaded.asset.customMetadata.originalName,"demo.png");
  assert.equal(uploaded.asset.customMetadata.source,"OFFICE");
  assert.equal(uploaded.asset.customMetadata.sha256.length,64);

  const list=await gate.fetch(new Request("https://office.example/office/api/assets",{headers:{cookie}}),environment);
  assert.equal(list.status,200);
  const listed=await list.json();
  assert.equal(listed.assets.length,1);
  assert.equal(listed.assets[0].key,uploaded.asset.key);

  const raw=await gate.fetch(new Request(
    "https://office.example/office/api/assets?raw=1&key="+encodeURIComponent(uploaded.asset.key),
    {headers:{cookie}},
  ),environment);
  assert.equal(raw.status,200);
  assert.equal(raw.headers.get("content-type"),"image/png");
  assert.equal(await raw.text(),"png-demo");
});

test("Office R2 asset upload rejects unsupported file type and missing binding",async()=>{
  const{createOfficeGate}=await import(gateUrl+"?asset-negative="+Date.now());
  const gate=createOfficeGate();
  const bucket=new FakeR2();
  const environment=env(bucket);
  const cookie=await login(gate,environment);

  const bad=new FormData();
  bad.append("file",new Blob(["x"],{type:"text/plain"}),"bad.txt");
  const denied=await gate.fetch(new Request("https://office.example/office/api/assets",{
    method:"POST",
    headers:{cookie,origin:"https://office.example"},
    body:bad,
  }),environment);
  assert.equal(denied.status,415);
  assert.deepEqual(await denied.json(),{code:"OFFICE_ASSET_TYPE_DENIED"});

  const missing=await gate.fetch(new Request("https://office.example/office/api/assets",{headers:{cookie}}),{
    ...environment,
    OFFICE_ASSETS:undefined,
  });
  assert.equal(missing.status,503);
  assert.deepEqual(await missing.json(),{code:"OFFICE_ASSETS_NOT_CONFIGURED"});
});
