'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const vm = require('node:vm');
const origin = 'https://hub.example';
async function setup() {
  const { createEdgeWorkerHandler } = await import(pathToFileURL(path.resolve(__dirname, '../go-hub-edge-worker.mjs')));
  const { LighthouseControlPortSessionRegistry } = await import(pathToFileURL(path.resolve(__dirname, '../go-hub-lighthouse-control-port-session.js')));
  const data = new Map();
  const registry = new LighthouseControlPortSessionRegistry({ storage:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)} });
  const env = {
    GOHUB_OWNER_PASSCODE:'test-owner',
    ERGASTERION_HUB_SHARED_SECRET:'factory-secret',
    LIGHTHOUSE_CONTROL_PORT_SESSIONS:{getByName:()=>registry},
    ERGASTERION_FACTORY:{fetch:async request=>{
      const payload=await request.clone().json();
      const workContext=payload.workContext||{};
      if(payload.operation!=='issue')return Response.json({ok:false,code:'UNEXPECTED_OPERATION',source:'PRISM_BROWSER',workContext},{status:400});
      return Response.json({
        ok:true,
        schemaVersion:'PRISM_OBSERVER_BOOTSTRAP_V1',
        factoryOrigin:'https://ergasterion-factory.pureekangraw.workers.dev',
        source:'PRISM_BROWSER',
        observerVersion:'0.3.1',
        sessionId:'observer-session-1',
        adapterId:payload.adapterId,
        sessionToken:'a'.repeat(64),
        expiresAt:Date.now()+3600000,
        workContext,
        screenshotConsent:false,
        createsAuthority:false,
      },{status:201});
    }},
  };
  const handler = createEdgeWorkerHandler({delegate:{fetch:async()=>new Response('delegate')},factoryMcp:{fetch:async()=>new Response('mcp')}});
  return {data,fetch:(url,init)=>handler.fetch(new Request(new URL(url,origin),init),env)};
}
test('PRISM pairing form opens without Centre identity while the owner room remains gated', async()=>{
  const app = await setup();
  const page = await app.fetch('/hub/prism/pairing');
  assert.equal(page.status,200);
  assert.match(page.headers.get('content-type'),/text\/html/);
  assert.equal(page.headers.get('cache-control'),'no-store');
  const html = await page.text();
  assert.match(html,/<title>PRISM/);
  assert.match(html,/id="passcode"/);
  assert.match(html,/id="bootstrap"/);
  const room = await app.fetch('/hub/lighthouse');
  assert.equal(room.status,403);
  assert.equal((await room.json()).code,'LIGHTHOUSE_CENTRE_PASS_REQUIRED');
});
test('rendered PRISM form issues a real session, clears passcode and copies only bootstrap',async()=>{
  const app = await setup();
  const html = await (await app.fetch('/hub/prism/pairing')).text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script,'pairing page must include its working form controller');
  const nodes = Object.fromEntries(['pair','passcode','label','bootstrap','status','copy','observer-pair','observer-passcode','observer-work','observer-checkpoint','observer-adapter','observer-bootstrap','observer-status','observer-copy'].map(id=>[id,{value:'',textContent:'',disabled:false,addEventListener(event,fn){this[event]=fn;}}]));
  nodes.passcode.value='test-owner'; nodes.label.value='PRISM phone';
  let copied;
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id]},fetch:app.fetch,navigator:{clipboard:{writeText:async value=>{copied=value;}}}});
  await nodes.pair.submit({preventDefault(){}});
  assert.equal(nodes.passcode.value,'');
  const bootstrap = JSON.parse(nodes.bootstrap.value);
  assert.equal(bootstrap.ok,true);
  assert.equal(bootstrap.contract,'lighthouse-control-port-v1');
  assert.equal(bootstrap.hub_origin,origin);
  assert.match(bootstrap.session_token,/^[a-f0-9]{64}$/);
  assert.ok(bootstrap.expires_at>Date.now());
  assert.equal(nodes.bootstrap.value.includes('test-owner'),false);
  assert.equal(JSON.stringify([...app.data]).includes('test-owner'),false);
  assert.equal(JSON.stringify([...app.data]).includes(bootstrap.session_token),false);
  await nodes.copy.click();
  assert.equal(copied,nodes.bootstrap.value);
  const read = await app.fetch('/hub/api/lighthouse-control-port/pull',{method:'POST',headers:{'x-lighthouse-session-id':bootstrap.session_id,'x-lighthouse-session-token':bootstrap.session_token}});
  assert.equal(read.status,200);
});
test('PRISM pairing page also issues a Factory Browser Eye bootstrap for one Work',async()=>{
  const app=await setup();
  const html=await (await app.fetch('/hub/prism/pairing')).text();
  assert.match(html,/Browser Eye/);
  assert.match(html,/observer-work/);
  assert.match(html,/ข้อมูลจับคู่จาก Factory/);

  const workContext={workId:'WORK-PRISM-EYE',checkpointId:'CP-WORK-PRISM-EYE'};
  const response=await app.fetch('/hub/api/lighthouse-control-port/prism/observer/session/start',{
    method:'POST',
    headers:{'content-type':'application/json','x-go-owner-passcode':'test-owner'},
    body:JSON.stringify({workContext,adapterId:'PRISM-ANDROID',ttlSeconds:3600}),
  });
  assert.equal(response.status,201);
  const body=await response.json();
  assert.equal(body.ok,true);
  assert.equal(body.schemaVersion,'PRISM_OBSERVER_BOOTSTRAP_V1');
  assert.equal(body.source,'PRISM_BROWSER');
  assert.equal(body.adapterId,'PRISM-ANDROID');
  assert.deepEqual(body.workContext,workContext);
  assert.match(body.sessionToken,/^[a-f0-9]{64}$/);
  assert.equal(body.createsAuthority,false);
  assert.equal(JSON.stringify(body).includes('test-owner'),false);
});

test('Browser Eye pairing rejects wrong owner code and missing Work context',async()=>{
  const app=await setup();
  const wrong=await app.fetch('/hub/api/lighthouse-control-port/prism/observer/session/start',{
    method:'POST',headers:{'content-type':'application/json','x-go-owner-passcode':'wrong'},
    body:JSON.stringify({workContext:{workId:'W',checkpointId:'CP'}}),
  });
  assert.equal(wrong.status,403);
  assert.equal((await wrong.json()).code,'OWNER_AUTH_FAILED');

  const missing=await app.fetch('/hub/api/lighthouse-control-port/prism/observer/session/start',{
    method:'POST',headers:{'content-type':'application/json','x-go-owner-passcode':'test-owner'},
    body:JSON.stringify({workContext:{workId:'W',checkpointId:''}}),
  });
  assert.equal(missing.status,400);
  assert.equal((await missing.json()).code,'WORK_CONTEXT_REQUIRED');
});

test('session issuer denies missing and wrong owner code without creating a session',async()=>{
  const app = await setup();
  for(const code of ['', 'wrong']){
    const response=await app.fetch('/hub/api/lighthouse-control-port/session/start',{method:'POST',headers:{'content-type':'application/json','x-go-owner-passcode':code},body:'{}'});
    assert.equal(response.status,403);
    assert.equal((await response.json()).code,'OWNER_AUTH_FAILED');
  }
  assert.equal(app.data.size,0);
});

test('deployed asset routing sends PRISM pairing to the worker before SPA fallback',()=>{
  const fs=require('node:fs');
  const config=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../wrangler.go-hub.jsonc'),'utf8'));
  assert.ok(config.assets.run_worker_first.includes('/hub/prism/pairing'));
});
