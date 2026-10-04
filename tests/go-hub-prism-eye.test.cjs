const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const wc={workId:'W-PRISM',checkpointId:'CP-PRISM'};
test('Hub sends Work-bound signed request to the direct Factory admin endpoint',async()=>{
  const {createPrismEyeService}=await import('../go-hub-prism-eye.mjs');
  const crypto=require('node:crypto');let request;
  const service=createPrismEyeService({endpoint:'https://factory.test',secret:'secret',fetchImpl:async(url,init)=>{
    request={url,init};
    assert.equal(url,'https://factory.test/api/prism-eye/admin');
    assert.equal(init.headers['x-go-hub-protocol'],'GO_HUB_ERGASTERION_FACTORY_V1');
    const expected=crypto.createHmac('sha256','secret').update(init.headers['x-go-hub-timestamp']+'.'+init.body).digest('hex');
    assert.equal(init.headers['x-go-hub-signature'],expected);
    const payload=JSON.parse(init.body);assert.deepEqual(payload.workContext,wc);assert.equal(payload.operation,'latest');
    return Response.json({ok:true,source:'PRISM_BROWSER',workContext:wc,state:'LIVE',evidenceLive:true,latest:{source:'PRISM_BROWSER',...wc,capturedAt:new Date().toISOString(),observationId:'O-1',page:{title:'Factory evidence'}}});
  }});
  const result=await(await service.latest({workContext:wc})).json();assert.ok(request);assert.equal(result.latest.observationId,'O-1');assert.equal(result.evidenceLive,true);assert.equal(result.workContextBound,true);
});
test('readback refuses a foreign producer or Work and never upgrades old page capture to LIVE',async()=>{
  const {createPrismEyeService}=await import('../go-hub-prism-eye.mjs');
  for(const body of [{ok:true,source:'FACTORY_EYE',workContext:wc},{ok:true,source:'PRISM_BROWSER',workContext:{workId:'other',checkpointId:wc.checkpointId}}]){
    const service=createPrismEyeService({endpoint:'https://factory.test',secret:'secret',fetchImpl:async()=>Response.json(body)});const r=await service.latest({workContext:wc});assert.equal(r.status,502);
  }
  const body={ok:true,source:'PRISM_BROWSER',workContext:wc,evidenceLive:true,state:'LIVE',latest:{source:'PRISM_BROWSER',...wc,capturedAt:new Date(Date.now()-60000).toISOString()}};
  const service=createPrismEyeService({endpoint:'https://factory.test',secret:'secret',fetchImpl:async()=>Response.json(body)});const r=await(await service.latest({workContext:wc})).json();assert.equal(r.evidenceLive,false);assert.equal(r.state,'STALE');
});
test('missing Work and unavailable direct Factory transport fail closed',async()=>{
  const {createPrismEyeService}=await import('../go-hub-prism-eye.mjs');const service=createPrismEyeService();assert.equal((await service.latest({})).status,400);assert.equal((await service.latest({workContext:wc})).status,503);
});
