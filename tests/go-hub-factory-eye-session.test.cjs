"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const{pathToFileURL}=require("node:url");

const moduleUrl=pathToFileURL(path.resolve(__dirname,"..","go-hub-factory-eye-session.mjs")).href;

class MemoryStorage{
  constructor(){this.map=new Map()}
  async get(key){return this.map.get(key)}
  async put(key,value){this.map.set(key,structuredClone(value))}
  async delete(key){this.map.delete(key)}
}

async function load(tag){
  return import(moduleUrl+"?factory-eye="+tag+"-"+Date.now());
}

function page(url,title){
  return{
    schema:"ERGASTERION_BROWSER_PAGE_SUMMARY_V1",
    url,title,readyState:"complete",language:"en",description:null,
    headings:[{level:1,text:title}],
    buttons:[{label:"Continue",disabled:false}],
    links:[],fields:[{tag:"input",type:"text",name:"q",label:"Search",placeholder:"Search",disabled:false,readOnly:false,sensitive:false}],
    landmarks:[{role:"main",label:null}],
    capturedAt:new Date(2000).toISOString(),
    observerVersion:"0.2.3",
    visibilityState:"visible",
    documentFocused:true,
    capturesInputValues:false,
    createsAuthority:false,
  };
}

test("Factory Eye session accepts multiple ordinary domains without browser host policy",async()=>{
  const m=await load("multi-site");
  let clock=1000;
  const service=m.createFactoryEyeSessionService({
    storage:new MemoryStorage(),
    now:()=>clock,
    randomUUID:()=>"eye-session-1",
    tokenFactory:()=>"eye-token-1",
  });
  const started=await service.start({adapterId:"FIREFOX-PHONE",ttlMs:600000});
  assert.equal(started.ok,true);
  assert.equal(started.session_token,"eye-token-1");

  clock=1500;
  assert.equal((await service.register({
    sessionId:"eye-session-1",sessionToken:"eye-token-1",adapterId:"FIREFOX-PHONE",
    host:"firefox-addon",version:"0.2.3",protocolVersion:"2",
    capabilities:{tabs:true,observe:true,screenshot:true},limits:["NO_INPUT_VALUES_CAPTURED"],
  })).ok,true);

  assert.equal((await service.heartbeat({
    sessionId:"eye-session-1",sessionToken:"eye-token-1",adapterId:"FIREFOX-PHONE",activeTabId:2,
    tabs:[
      {tabId:1,windowId:1,url:"https://example.com/",title:"Example Domain",active:false},
      {tabId:2,windowId:1,url:"https://developer.mozilla.org/",title:"MDN",active:true},
    ],
  })).ok,true);

  clock=2000;
  const observed=await service.observe({
    sessionId:"eye-session-1",sessionToken:"eye-token-1",adapterId:"FIREFOX-PHONE",
    observationId:"OBS-1",observedAt:new Date(clock).toISOString(),
    tab:{tabId:2,windowId:1,url:"https://developer.mozilla.org/",title:"MDN",active:true},
    page:page("https://developer.mozilla.org/","MDN"),
    contentScriptVersion:"0.2.3",documentVisible:true,documentFocused:true,
    screenshotDataUrl:"data:image/png;base64,AA==",
    status:"OBSERVED",unknowns:[],
  });
  assert.equal(observed.ok,true);
  assert.match(observed.observation.screenshotRef,/^factory-eye-shot:/);

  const latest=await service.latest();
  assert.equal(latest.ok,true);
  assert.equal(latest.source,"FACTORY_EYE");
  assert.equal(latest.state,"LIVE");
  assert.equal(latest.freshness.evidenceLive,true);
  assert.equal(latest.freshness.tabMatch,true);
  assert.equal(latest.freshness.generationMatch,true);
  assert.equal(latest.tabs.length,2);
  assert.deepEqual(latest.tabs.map(tab=>new URL(tab.url).hostname).sort(),["developer.mozilla.org","example.com"]);
  assert.equal(latest.latest.page.capturesInputValues,false);
  assert.equal(Object.hasOwn(latest.latest.page.fields[0],"value"),false);

  const shot=await service.screenshot({screenshotRef:observed.observation.screenshotRef});
  assert.equal(shot.ok,true);
  assert.equal(shot.screenshot.dataUrl,"data:image/png;base64,AA==");
});

test("Factory Eye session rejects wrong token and unsafe page summary declarations",async()=>{
  const m=await load("security");
  let clock=1000;
  const service=m.createFactoryEyeSessionService({
    storage:new MemoryStorage(),now:()=>clock,randomUUID:()=>"s",tokenFactory:()=>"t",
  });
  await service.start({adapterId:"A",ttlMs:600000});

  const wrong=await service.heartbeat({sessionId:"s",sessionToken:"wrong",adapterId:"A",tabs:[]});
  assert.deepEqual(wrong,{ok:false,code:"FACTORY_EYE_SESSION_INACTIVE"});

  clock=2000;
  const unsafe=page("https://example.com/","Example");
  unsafe.capturesInputValues=true;
  const result=await service.observe({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    observationId:"OBS-unsafe",observedAt:new Date(clock).toISOString(),
    tab:{tabId:1,windowId:1,url:"https://example.com/",title:"Example",active:true},
    page:unsafe,status:"OBSERVED",
  });
  assert.deepEqual(result,{ok:false,code:"FACTORY_EYE_PAGE_SUMMARY_INVALID"});
});

test("Factory Eye stale state never pretends to be live",async()=>{
  const m=await load("stale");
  let clock=1000;
  const service=m.createFactoryEyeSessionService({
    storage:new MemoryStorage(),now:()=>clock,randomUUID:()=>"s",tokenFactory:()=>"t",
  });
  await service.start({adapterId:"A",ttlMs:600000});
  await service.heartbeat({sessionId:"s",sessionToken:"t",adapterId:"A",tabs:[]});
  clock=25_001;
  const latest=await service.latest();
  assert.equal(latest.state,"STALE");
});


test("Factory Eye reports WARMING_UP when heartbeat active tab and latest evidence disagree",async()=>{
  const m=await load("tab-mismatch");
  let clock=1000;
  const service=m.createFactoryEyeSessionService({
    storage:new MemoryStorage(),now:()=>clock,randomUUID:()=>"s",tokenFactory:()=>"t",
  });
  await service.start({adapterId:"A",ttlMs:600000});
  await service.register({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    host:"firefox-addon",version:"0.2.3",protocolVersion:"2",
  });
  await service.heartbeat({
    sessionId:"s",sessionToken:"t",adapterId:"A",activeTabId:1,
    tabs:[{tabId:1,windowId:1,url:"https://example.com/",title:"Example",active:true}],
  });
  clock=2000;
  await service.observe({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    observationId:"OBS-1",observedAt:new Date(clock).toISOString(),
    tab:{tabId:1,windowId:1,url:"https://example.com/",title:"Example",active:true},
    page:page("https://example.com/","Example"),
    contentScriptVersion:"0.2.3",documentVisible:true,status:"OBSERVED",
  });

  clock=2500;
  await service.heartbeat({
    sessionId:"s",sessionToken:"t",adapterId:"A",activeTabId:2,
    tabs:[
      {tabId:1,windowId:1,url:"https://example.com/",title:"Example",active:false},
      {tabId:2,windowId:1,url:"https://developer.mozilla.org/",title:"MDN",active:true},
    ],
  });

  const latest=await service.latest();
  assert.equal(latest.state,"WARMING_UP");
  assert.equal(latest.freshness.transportState,"LIVE");
  assert.equal(latest.freshness.tabMatch,false);
  assert.equal(latest.freshness.activeTabId,2);
  assert.equal(latest.freshness.observationTabId,1);
});

test("Factory Eye v0.2.3 rejects stale content-script generation",async()=>{
  const m=await load("generation");
  let clock=1000;
  const service=m.createFactoryEyeSessionService({
    storage:new MemoryStorage(),now:()=>clock,randomUUID:()=>"s",tokenFactory:()=>"t",
  });
  await service.start({adapterId:"A",ttlMs:600000});
  await service.register({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    host:"firefox-addon",version:"0.2.3",protocolVersion:"2",
  });
  clock=2000;
  const oldPage=page("https://example.com/","Example");
  oldPage.observerVersion="0.2.2";
  const result=await service.observe({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    observationId:"OBS-old",observedAt:new Date(clock).toISOString(),
    tab:{tabId:1,windowId:1,url:"https://example.com/",title:"Example",active:true},
    page:oldPage,contentScriptVersion:"0.2.2",documentVisible:true,status:"OBSERVED",
  });
  assert.deepEqual(result,{ok:false,code:"FACTORY_EYE_SCRIPT_VERSION_STALE"});
});

test("Factory Eye v0.2.3 rejects visible web evidence from a non-active tab",async()=>{
  const m=await load("inactive");
  let clock=1000;
  const service=m.createFactoryEyeSessionService({
    storage:new MemoryStorage(),now:()=>clock,randomUUID:()=>"s",tokenFactory:()=>"t",
  });
  await service.start({adapterId:"A",ttlMs:600000});
  await service.register({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    host:"firefox-addon",version:"0.2.3",protocolVersion:"2",
  });
  clock=2000;
  const result=await service.observe({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    observationId:"OBS-inactive",observedAt:new Date(clock).toISOString(),
    tab:{tabId:1,windowId:1,url:"https://example.com/",title:"Example",active:false},
    page:page("https://example.com/","Example"),
    contentScriptVersion:"0.2.3",documentVisible:true,status:"OBSERVED",
  });
  assert.deepEqual(result,{ok:false,code:"FACTORY_EYE_OBSERVATION_NOT_ACTIVE"});
});


test("Factory Eye retains previous and current frames for live visual compare",async()=>{
  const m=await load("visual-compare");
  let clock=1000;
  const storage=new MemoryStorage();
  const service=m.createFactoryEyeSessionService({
    storage,now:()=>clock,randomUUID:()=>"s",tokenFactory:()=>"t",
  });
  await service.start({adapterId:"A",ttlMs:600000});
  await service.register({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    host:"firefox-addon",version:"0.2.3",protocolVersion:"2",
  });
  await service.heartbeat({
    sessionId:"s",sessionToken:"t",adapterId:"A",activeTabId:1,
    tabs:[{tabId:1,windowId:1,url:"https://example.com/",title:"One",active:true}],
  });

  clock=2000;
  const firstPage=page("https://example.com/","One");
  firstPage.capturedAt=new Date(clock).toISOString();
  const first=await service.observe({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    observationId:"OBS-1",observedAt:new Date(clock).toISOString(),
    tab:{tabId:1,windowId:1,url:"https://example.com/",title:"One",active:true},
    page:firstPage,contentScriptVersion:"0.2.3",documentVisible:true,
    screenshotDataUrl:"data:image/png;base64,AA==",status:"OBSERVED",
  });
  assert.equal(first.ok,true);

  clock=3000;
  const secondPage=page("https://example.com/","Two");
  secondPage.capturedAt=new Date(clock).toISOString();
  const second=await service.observe({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    observationId:"OBS-2",observedAt:new Date(clock).toISOString(),
    tab:{tabId:1,windowId:1,url:"https://example.com/",title:"Two",active:true},
    page:secondPage,contentScriptVersion:"0.2.3",documentVisible:true,
    screenshotDataUrl:"data:image/png;base64,AQ==",status:"OBSERVED",
  });
  assert.equal(second.ok,true);

  const latest=await service.latest();
  assert.equal(latest.previous.observationId,"OBS-1");
  assert.equal(latest.latest.observationId,"OBS-2");
  assert.equal(latest.comparison.ready,true);
  assert.equal(latest.comparison.sameTab,true);
  assert.equal(latest.comparison.sameUrl,true);
  assert.equal(latest.comparison.pageChanged,true);
  assert.equal(latest.comparison.screenshotChanged,true);
  assert.equal(latest.comparison.visualCompareReady,true);
  assert.equal(latest.comparison.previousScreenshotRef,first.observation.screenshotRef);
  assert.equal(latest.comparison.currentScreenshotRef,second.observation.screenshotRef);

  const oldShot=await service.screenshot({screenshotRef:first.observation.screenshotRef});
  const newShot=await service.screenshot({screenshotRef:second.observation.screenshotRef});
  assert.equal(oldShot.ok,true);
  assert.equal(newShot.ok,true);
  assert.equal(oldShot.screenshot.dataUrl,"data:image/png;base64,AA==");
  assert.equal(newShot.screenshot.dataUrl,"data:image/png;base64,AQ==");
});

test("Factory Eye visual compare screenshot buffer stays bounded to two frames",async()=>{
  const m=await load("visual-compare-bound");
  let clock=1000;
  const service=m.createFactoryEyeSessionService({
    storage:new MemoryStorage(),now:()=>clock,randomUUID:()=>"s",tokenFactory:()=>"t",
  });
  await service.start({adapterId:"A",ttlMs:600000});
  await service.register({
    sessionId:"s",sessionToken:"t",adapterId:"A",
    host:"firefox-addon",version:"0.2.3",protocolVersion:"2",
  });
  await service.heartbeat({
    sessionId:"s",sessionToken:"t",adapterId:"A",activeTabId:1,
    tabs:[{tabId:1,windowId:1,url:"https://example.com/",title:"Example",active:true}],
  });

  const refs=[];
  for (const [index,data] of ["AA==","AQ==","Ag=="].entries()) {
    clock=2000+index*1000;
    const currentPage=page("https://example.com/","Frame "+(index+1));
    currentPage.capturedAt=new Date(clock).toISOString();
    const observed=await service.observe({
      sessionId:"s",sessionToken:"t",adapterId:"A",
      observationId:"OBS-"+(index+1),observedAt:new Date(clock).toISOString(),
      tab:{tabId:1,windowId:1,url:"https://example.com/",title:"Frame "+(index+1),active:true},
      page:currentPage,contentScriptVersion:"0.2.3",documentVisible:true,
      screenshotDataUrl:"data:image/png;base64,"+data,status:"OBSERVED",
    });
    refs.push(observed.observation.screenshotRef);
  }

  assert.equal((await service.screenshot({screenshotRef:refs[0]})).ok,false);
  assert.equal((await service.screenshot({screenshotRef:refs[1]})).ok,true);
  assert.equal((await service.screenshot({screenshotRef:refs[2]})).ok,true);

  const latest=await service.latest();
  assert.equal(latest.previous.observationId,"OBS-2");
  assert.equal(latest.latest.observationId,"OBS-3");
  assert.equal(latest.comparison.visualCompareReady,true);
});


test("Factory Eye owner observe-now request is bounded, delivered, and cleared by receipt",async()=>{
  const m=await load("observe-now-command");
  let clock=1000;
  let uuid=0;
  const service=m.createFactoryEyeSessionService({
    storage:new MemoryStorage(),now:()=>clock,randomUUID:()=>"cmd-"+(++uuid),tokenFactory:()=>"t",
  });
  const started=await service.start({adapterId:"A",ttlMs:600000});
  const sessionId=started.session_id;
  await service.register({sessionId,sessionToken:"t",adapterId:"A",host:"firefox-addon",version:"0.3.1",protocolVersion:"2"});

  const requested=await service.requestObservation({requestedBy:"BIG"});
  assert.equal(requested.ok,true);
  assert.equal(requested.command.type,"OBSERVE_NOW");
  assert.equal(requested.command.createsAuthority,false);

  const pulled=await service.pullCommands({sessionId,sessionToken:"t",adapterId:"A"});
  assert.equal(pulled.ok,true);
  assert.equal(pulled.capability,"EYES_ONLY_OBSERVE_NOW");
  assert.equal(pulled.commands.length,1);
  assert.equal(pulled.commands[0].type,"OBSERVE_NOW");
  assert.equal(pulled.commands[0].createsAuthority,false);

  const duplicate=await service.pullCommands({sessionId,sessionToken:"t",adapterId:"A"});
  assert.equal(duplicate.commands.length,0);

  const receipt=await service.receipt({
    sessionId,sessionToken:"t",adapterId:"A",commandId:pulled.commands[0].commandId,
    status:"COMPLETED",followUpObservationId:"OBS-FRESH",
  });
  assert.equal(receipt.ok,true);
  const after=await service.pullCommands({sessionId,sessionToken:"t",adapterId:"A"});
  assert.equal(after.commands.length,0);
  const latest=await service.latest();
  assert.equal(latest.latestReceipt.followUpObservationId,"OBS-FRESH");
});
