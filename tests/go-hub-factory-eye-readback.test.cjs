"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const{pathToFileURL}=require("node:url");

const moduleUrl=pathToFileURL(path.resolve(__dirname,"..","go-hub-factory-mcp-worker.mjs")).href;
async function load(tag){return import(moduleUrl+"?factory-eye-readback="+tag+"-"+Date.now())}

function namespace(name,handler){
  return{getByName(actual){assert.equal(actual,name);return{fetch:handler}}};
}

test("observer latest prefers Factory Eye evidence over legacy observer",async()=>{
  const{createObserverEvidenceService}=await load("latest");
  let legacyCalls=0;
  const factoryEyeNamespace=namespace("ergasterion-factory-eye-v1",async request=>{
    assert.equal(new URL(request.url).pathname,"/latest");
    return new Response(JSON.stringify({
      ok:true,source:"FACTORY_EYE",state:"LIVE",
      tabs:[
        {tabId:1,url:"https://example.com/",active:false},
        {tabId:2,url:"https://developer.mozilla.org/",active:true},
      ],
      latest:{observationId:"OBS-1",page:{title:"MDN"},screenshotRef:"factory-eye-shot:S:OBS-1"},
      createsAuthority:false,
    }),{headers:{"content-type":"application/json"}});
  });
  const legacyNamespace=namespace("go-browser-observer-v1",async()=>{
    legacyCalls+=1;
    return new Response(JSON.stringify({ok:true,latest:{page_title:"Legacy"}}),{headers:{"content-type":"application/json"}});
  });

  const service=createObserverEvidenceService({namespace:legacyNamespace,factoryEyeNamespace});
  const response=await service.latest({workContext:{workId:"WORK-FACTORY-EYE",checkpointId:"CP-FACTORY-EYE"}});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.source,"FACTORY_EYE");
  assert.equal(body.legacyBrowserPolicyUsed,false);
  assert.equal(body.latest.page.title,"MDN");
  assert.equal(legacyCalls,0);
});

test("observer screenshot routes Factory Eye refs to Factory Eye storage",async()=>{
  const{createObserverEvidenceService}=await load("shot");
  const factoryEyeNamespace=namespace("ergasterion-factory-eye-v1",async request=>{
    assert.equal(new URL(request.url).pathname,"/screenshot");
    const input=await request.json();
    assert.equal(input.screenshotRef,"factory-eye-shot:S:OBS-1");
    return new Response(JSON.stringify({
      ok:true,screenshot:{ref:input.screenshotRef,dataUrl:"data:image/png;base64,AA=="},
    }),{headers:{"content-type":"application/json"}});
  });
  const service=createObserverEvidenceService({namespace:null,factoryEyeNamespace});
  const response=await service.screenshot({screenshotRef:"factory-eye-shot:S:OBS-1"});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.source,"FACTORY_EYE");
  assert.equal(body.screenshot.dataUrl,"data:image/png;base64,AA==");
});
