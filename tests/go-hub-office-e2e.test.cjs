"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");

const workerUrl=pathToFileURL(path.resolve(__dirname,"../go-hub-edge-worker.mjs")).href;

function delegate(){return{async fetch(){return new Response("delegate",{status:202})}}}
function mcp(){return{async fetch(){return new Response("mcp")}}}

function officeEnv({eyeState="STALE"}={}){
  const centreByWork=new Map();
  const missionByWork=new Map();

  const centreNamespace={
    getByName(workId){
      return{
        async fetch(request){
          const input=await request.json();
          const action=String(input.action||"");
          if(action==="v4_create"){
            const work={
              ...(input.work||{}),
              workId,
              checkpointId:"CP-"+workId.slice(-12),
              status:"OPEN",
              holder:null,
              requestedDestinations:[],
              toolAccess:[],
              lastUpdated:"2026-10-02T06:00:00.000Z",
            };
            centreByWork.set(workId,work);
            return json({ok:true,v4:true,work},201);
          }
          const work=centreByWork.get(workId);
          if(!work) return json({code:"CENTRE_WORK_NOT_FOUND"},404);
          if(action==="v4_claim"){
            work.status="ON PROCESS";
            work.holder=String(input.actor||"GO");
            work.lastUpdated="2026-10-02T06:00:01.000Z";
            return json({ok:true,v4:true,work});
          }
          if(action==="v4_mission_enter"){
            missionByWork.set(workId,{
              session:{sessionId:input.sessionId,agentId:input.agentId||"GO",status:"ACTIVE"},
              memory:{
                mission:input.mission,
                requestedResult:input.requestedResult,
                selectedContext:[],
                latestReality:null,
                cardMachine:{current:null},
              },
            });
            return json({ok:true,mission:missionByWork.get(workId)});
          }
          if(action==="v4_mission_card_prepare"){
            const mission=missionByWork.get(workId);
            const jobCode="0001-E2E";
            mission.memory.cardMachine.current={
              cardId:"CARD:"+jobCode,
              tabletId:"TABLET:"+jobCode,
              jobCode,
              version:1,
              agentId:input.agentId||"GO",
              sessionId:input.sessionId,
              workId,
              checkpointId:work.checkpointId,
              task:mission.memory.mission,
              initialContext:input.initialContext||{},
              status:work.status,
              result:null,
              evidence:[],
              tool_access:[],
              destinations:[],
              intent:{mission:mission.memory.mission,requestedResult:mission.memory.requestedResult},
            };
            return json({ok:true,mission});
          }
          if(action==="v4_mission_card_issue"){
            return json({ok:true,mission:missionByWork.get(workId)});
          }
          if(action==="v4_mission_get"){
            return json({ok:true,v4:true,work,mission:missionByWork.get(workId)});
          }
          if(action==="v4_inspect"){
            return json({ok:true,v4:true,work});
          }
          return json({code:"UNSUPPORTED_TEST_ACTION_"+action},400);
        },
      };
    },
  };

  const lighthouseNamespace={
    getByName(){
      return{
        async fetch(request){
          const pathname=new URL(request.url).pathname;
          if(pathname==="/board/latest"){
            return json({ok:true,board:{boardId:"E2E",revision:1,pins:[],updatedAt:"2026-10-02T06:00:00.000Z"}});
          }
          return json({code:"NOT_FOUND"},404);
        },
      };
    },
  };

  const eyeNamespace={
    getByName(name){
      assert.equal(name,"ergasterion-factory-eye-v1");
      return{
        async fetch(request){
          const pathname=new URL(request.url).pathname;
          if(pathname==="/request-observe"){
            const input=await request.json();
            return json({ok:true,command:{commandId:"EYE-CMD-E2E",type:"OBSERVE_NOW",requestedBy:input.requestedBy,createsAuthority:false}});
          }
          if(pathname==="/latest"){
            return json({
              ok:true,
              source:"FACTORY_EYE",
              state:eyeState,
              freshness:{
                state:eyeState,
                transportState:eyeState==="WARMING_UP"?"LIVE":eyeState,
                evidenceLive:eyeState==="LIVE",
              },
              tabs:[{tabId:9,active:true,url:"https://example.com/",title:"Example"}],
              latest:{
                observationId:"OBS-E2E",
                observedAt:"2026-10-02T06:00:00.000Z",
                receivedAt:"2026-10-02T06:00:01.000Z",
                tab:{tabId:9,active:true,url:"https://example.com/",title:"Example"},
                page:{title:"Example",capturesInputValues:false,createsAuthority:false},
                screenshotRef:"factory-eye-shot:E2E:OBS-E2E",
                source:"FACTORY_EYE",
                createsAuthority:false,
              },
              comparison:{ready:false},
              createsAuthority:false,
            });
          }
          if(pathname==="/screenshot"){
            const input=await request.json();
            return json({
              ok:true,
              source:"FACTORY_EYE",
              screenshot:{ref:input.screenshotRef,capturedAt:"2026-10-02T06:00:00.000Z",dataUrl:"data:image/png;base64,AA=="},
            });
          }
          return json({code:"NOT_FOUND"},404);
        },
      };
    },
  };

  return{
    env:{
      GOHUB_OFFICE_PASSCODE:"office-secret",
      GOHUB_OFFICE_SESSION_KEY:"0123456789abcdef0123456789abcdef",
      GOHUB_OFFICE_SESSION_EPOCH:"1",
      GOHUB_OFFICE_SESSION_TTL_SECONDS:"3600",
      GO_HUB_CENTRE_STATE:centreNamespace,
      LIGHTHOUSE_CONTROL_PORT_SESSIONS:lighthouseNamespace,
      FACTORY_EYE_SESSIONS:eyeNamespace,
    },
    centreByWork,
  };
}

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}

async function login(handler,env){
  const response=await handler.fetch(new Request("https://office.example/office/login",{
    method:"POST",
    headers:{origin:"https://office.example","content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({passcode:"office-secret"}),
  }),env);
  assert.equal(response.status,303);
  return (response.headers.get("set-cookie")||"").split(";")[0];
}

test("Office E2E happy path: login -> Agent Mission command -> Centre read -> Factory Eye readback",async()=>{
  const{createEdgeWorkerHandler}=await import(workerUrl+"?office-e2e="+Date.now());
  const handler=createEdgeWorkerHandler({delegate:delegate(),factoryMcp:mcp()});
  const state=officeEnv({eyeState:"LIVE"});
  const cookie=await login(handler,state.env);

  const command=await handler.fetch(new Request("https://office.example/office/api/command",{
    method:"POST",
    headers:{cookie,origin:"https://office.example","content-type":"application/json"},
    body:JSON.stringify({
      action:"create_tablet",
      agentId:"GO",
      mission:"Office E2E mission",
      requestedResult:"Prove Centre and Eye readback",
      workKey:"OFFICE-E2E",
      workType:"NORMAL",
      initialContext:{source:"OFFICE_E2E"},
    }),
  }),state.env);
  assert.equal(command.status,201);
  const commandBody=await command.json();
  assert.equal(commandBody.ok,true);
  assert.equal(commandBody.action,"create_tablet");
  assert.match(commandBody.tabletId,/^TABLET:/);
  assert.ok(commandBody.workContext?.workId);
  assert.ok(commandBody.workContext?.checkpointId);

  const work=await handler.fetch(new Request(
    "https://office.example/office/api/work?workId="+encodeURIComponent(commandBody.workContext.workId)+
    "&checkpointId="+encodeURIComponent(commandBody.workContext.checkpointId),
    {headers:{cookie}},
  ),state.env);
  assert.equal(work.status,200);
  const workBody=await work.json();
  assert.equal(workBody.work.workId,commandBody.workContext.workId);
  assert.equal(workBody.work.checkpointId,commandBody.workContext.checkpointId);
  assert.equal(workBody.work.status,"ON PROCESS");
  assert.equal(workBody.work.holder,"GO");

  const observeNow=await handler.fetch(new Request("https://office.example/office/api/eye/refresh",{
    method:"POST",
    headers:{cookie,origin:"https://office.example","content-type":"application/json"},
    body:"{}",
  }),state.env);
  assert.equal(observeNow.status,202);
  const observeBody=await observeNow.json();
  assert.equal(observeBody.ok,true);
  assert.equal(observeBody.command.type,"OBSERVE_NOW");
  assert.equal(observeBody.command.createsAuthority,false);
  assert.equal(observeBody.mode,"EYES_ONLY_OBSERVE_NOW");

  const eye=await handler.fetch(new Request("https://office.example/office/api/eye",{headers:{cookie}}),state.env);
  assert.equal(eye.status,200);
  const eyeBody=await eye.json();
  assert.equal(eyeBody.source,"FACTORY_EYE");
  assert.equal(eyeBody.mode,"READ_ONLY");
  assert.equal(eyeBody.state,"LIVE");
  assert.equal(eyeBody.freshness.evidenceLive,true);
  assert.equal(eyeBody.createsAuthority,false);
});

test("Office E2E negative paths: unauth, revoked session, stale Eye, safe error",async()=>{
  const{createEdgeWorkerHandler}=await import(workerUrl+"?office-e2e-negative="+Date.now());
  const handler=createEdgeWorkerHandler({delegate:delegate(),factoryMcp:mcp()});
  const state=officeEnv({eyeState:"STALE"});

  const unauth=await handler.fetch(new Request("https://office.example/office/api/eye"),state.env);
  assert.equal(unauth.status,401);
  assert.deepEqual(await unauth.json(),{code:"OFFICE_AUTH_REQUIRED"});

  const cookie=await login(handler,state.env);
  const stale=await handler.fetch(new Request("https://office.example/office/api/eye",{headers:{cookie}}),state.env);
  assert.equal(stale.status,200);
  const staleBody=await stale.json();
  assert.equal(staleBody.state,"STALE");
  assert.equal(staleBody.freshness.evidenceLive,false);

  const revokedEnv={...state.env,GOHUB_OFFICE_SESSION_EPOCH:"2"};
  const revoked=await handler.fetch(new Request("https://office.example/office/session",{headers:{cookie}}),revokedEnv);
  assert.equal(revoked.status,401);
  assert.deepEqual(await revoked.json(),{code:"OFFICE_SESSION_REVOKED"});

  const brokenEnv={...state.env,GO_HUB_CENTRE_STATE:{
    getByName(){return{async fetch(){throw new Error("SECRET_INTERNAL_STACK_VALUE")}}}
  }};
  const failure=await handler.fetch(new Request(
    "https://office.example/office/api/work?workId=WORK-X&checkpointId=CP-X",
    {headers:{cookie}},
  ),brokenEnv);
  assert.equal(failure.status,500);
  const failureText=await failure.text();
  assert.equal(failureText,JSON.stringify({code:"OFFICE_WORK_READ_FAILED"}));
  assert.doesNotMatch(failureText,/SECRET_INTERNAL_STACK_VALUE/);
});
