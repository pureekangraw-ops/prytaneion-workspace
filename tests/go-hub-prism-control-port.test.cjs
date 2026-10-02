'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');if(!globalThis.crypto)globalThis.crypto=webcrypto;
async function harness(){
  const {createLighthouseControlPortHttpService}=await import('../go-hub-lighthouse-control-port-service.mjs');
  const {createLighthouseControlPortSessionService}=await import('../go-hub-lighthouse-control-port-session.js');
  let now=1000;const data=new Map();const store={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>{data.set(k,structuredClone(v));}};
  const session=createLighthouseControlPortSessionService({storage:store,now:()=>now});
  const bootstrap=await session.start({deviceLabel:'PRISM',ttlMs:60000});let called=0;
  const service=createLighthouseControlPortHttpService({namespace:{getByName:()=>({fetch:async req=>{const b=await req.json();return Response.json(await session.board(b));}})},prismService:{handle:async()=>{called++;return Response.json({ok:true,status:'QUEUED',counterId:'C1'});}}});
  function request(token=bootstrap.session_token,origin='https://localhost'){return service.fetch(new Request('https://hub.example/hub/api/lighthouse-control-port/prism/handoff',{method:'POST',headers:{origin,'content-type':'application/json','x-lighthouse-session-id':bootstrap.session_id,'x-lighthouse-session-token':token},body:JSON.stringify({workId:'W1',checkpointId:'C1'})}));}
  return {request,called:()=>called,expire:()=>{now=9999999;}};
}
test('paired native PRISM reaches return channel with CORS and a real queued receipt',async()=>{const h=await harness();const r=await h.request();assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'https://localhost');assert.equal((await r.json()).status,'QUEUED');assert.equal(h.called(),1);});
test('invalid session cannot dispatch through PRISM return channel',async()=>{const h=await harness();assert.equal((await h.request('bad')).status,403);assert.equal(h.called(),0);});
test('expired session cannot dispatch through PRISM return channel',async()=>{const h=await harness();h.expire();assert.equal((await h.request()).status,410);assert.equal(h.called(),0);});
test('foreign browser origin cannot dispatch through PRISM return channel',async()=>{const h=await harness();assert.equal((await h.request(undefined,'https://evil.example')).status,403);assert.equal(h.called(),0);});

async function returnService({dispatchCode=null,workStatus='ON PROCESS'}={}){
  const {createPrismControlPortService}=await import('../go-hub-prism-control-port.mjs');
  const {createCounterCore}=await import('../go-hub-counter.mjs');const core=createCounterCore();const tickets=new Map();
  const service=createPrismControlPortService({centre:{action:async()=>Response.json({work:{workId:'W1',checkpointId:'C1',status:workStatus}})},counter:{get:async input=>Response.json(core.get(input,tickets.get(input.counterId)))},lifecycle:{create:async input=>{const result=core.create(input,tickets.get(input.counterId));tickets.set(input.counterId,result.counter);return Response.json({...result,dispatchCode});}}});
  return {service,tickets,core};
}
test('owner Work identity is checked before creating an actual durable Counter handoff',async()=>{
  const h=await returnService();await assert.rejects(h.service.handle('handoff',{workId:'W1',checkpointId:'wrong',destination:'LIGHT',requestedResult:'Inspect'}),/CONTEXT_MISMATCH/);assert.equal(h.tickets.size,0);
});
test('same owner handoff reuses one Counter and exposes the answer from that Counter',async()=>{
  const h=await returnService(),body={workId:'W1',checkpointId:'C1',destination:'LIGHT',requestedResult:'Inspect',message:'Read only'};
  const first=await (await h.service.handle('handoff',body)).json(),second=await (await h.service.handle('handoff',body)).json();assert.equal(first.counterId,second.counterId);assert.equal(h.tickets.size,1);
  const identity={counterId:first.counterId,actor:'LIGHT',workContext:{workId:'W1',checkpointId:'C1'}};
  const seen=h.core.seen(identity,h.tickets.get(first.counterId));
  const answered=h.core.answer({...identity,status:'ANSWERED',answer:'Readback from LIGHT',evidence:[{ref:'result://1'}],sources:['source://light'],confidence:'HIGH',nextRoute:'GO'},seen.counter);h.tickets.set(first.counterId,answered.counter);
  const result=await (await h.service.handle('result',{...body,counterId:first.counterId})).json();assert.equal(result.summary,'Readback from LIGHT');assert.equal(result.status,'ANSWERED');
});
test('known dispatcher failure is shown as BLOCKED rather than a delivered handoff',async()=>{
  const h=await returnService({dispatchCode:'LIGHT_OFFLINE'});const r=await (await h.service.handle('handoff',{workId:'W1',checkpointId:'C1',destination:'LIGHT',requestedResult:'Inspect'})).json();assert.equal(r.status,'BLOCKED');assert.match(r.summary,/LIGHT_OFFLINE/);
});

test('completed Work still permits Counter answer readback but rejects new handoffs',async()=>{
  const h=await returnService({workStatus:'COMPLETE'}),body={workId:'W1',checkpointId:'C1',destination:'LIGHT',requestedResult:'Inspect'};
  await assert.rejects(h.service.handle('handoff',body),/WORK_TERMINAL/);
  const counterId='COUNTER-PRISM-'+'a'.repeat(64);
  h.tickets.set(counterId,h.core.create({counterId,mode:'HANDOFF',fromActor:'GO',toActor:'LIGHT',request:'Inspect',requestedResult:'Inspect',workContext:body,context:{source:'PRISM_OWNER'}},null).counter);
  const result=await (await h.service.handle('result',{...body,counterId})).json();assert.equal(result.ok,true);assert.match(result.summary,/LIGHT/);
});
