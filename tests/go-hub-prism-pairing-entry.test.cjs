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
  const env = { GOHUB_OWNER_PASSCODE:'test-owner', LIGHTHOUSE_CONTROL_PORT_SESSIONS:{getByName:()=>registry} };
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
  const nodes = Object.fromEntries(['pair','passcode','label','bootstrap','status','copy'].map(id=>[id,{value:'',textContent:'',disabled:false,addEventListener(event,fn){this[event]=fn;}}]));
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
test('session issuer denies missing and wrong owner code without creating a session',async()=>{
  const app = await setup();
  for(const code of ['', 'wrong']){
    const response=await app.fetch('/hub/api/lighthouse-control-port/session/start',{method:'POST',headers:{'content-type':'application/json','x-go-owner-passcode':code},body:'{}'});
    assert.equal(response.status,403);
    assert.equal((await response.json()).code,'OWNER_AUTH_FAILED');
  }
  assert.equal(app.data.size,0);
});
