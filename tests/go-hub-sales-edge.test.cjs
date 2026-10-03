const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');const mod=f=>import(pathToFileURL(path.resolve(__dirname,'..',f)).href);
function namespace(Class){const states=new Map(),data=new Map();return {getByName(name){if(!states.has(name)){if(!data.has(name))data.set(name,new Map());const map=data.get(name),storage={get:async k=>structuredClone(map.get(k)),put:async(k,v)=>map.set(k,structuredClone(v)),list:async({prefix,limit=100,startAfter=''})=>new Map([...map].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit))};states.set(name,new Class({storage},{}));}return states.get(name);},restart(){states.clear();}};}
test('sales ingress persists at Centre and authenticated Office reads after restart',async()=>{
 const {createEdgeWorkerHandler}=await mod('go-hub-edge-worker.mjs');const {GoHubCentreState}=await mod('go-hub-centre-live.mjs');const ns=namespace(GoHubCentreState);
 const handler=createEdgeWorkerHandler({delegate:{fetch:async()=>Response.json({code:'delegate'})},factoryMcp:{fetch:async()=>new Response('mcp')}});
 const env={GO_HUB_CENTRE_STATE:ns,GOHUB_OFFICE_PASSCODE:'test-passcode',GOHUB_OFFICE_SESSION_KEY:'0123456789abcdef0123456789abcdef'};
 const payload={briefId:'BRIEF-test',clientId:'CLIENT-test',conversationId:'CONV-test',brief:{goal:'Real brief',jobType:'PROPOSAL'}};
 for(const operation of ['upsert','confirm'])assert.equal((await handler.fetch(new Request('https://go-hub.internal/internal/brief/'+operation,{method:'POST',body:JSON.stringify(payload)}),env)).status,200);
 ns.restart();
 const login=await handler.fetch(new Request('https://office.example/office/login',{method:'POST',headers:{origin:'https://office.example','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({passcode:'test-passcode'})}),env);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const read=await handler.fetch(new Request('https://office.example/office/api/sales',{headers:{cookie}}),env);assert.equal(read.status,200);
 const view=await read.json();assert.equal(view.briefs[0].brief.goal,'Real brief');assert.equal(view.briefs[0].status,'CONFIRMED');assert.equal(view.briefs[0].processing,'UNKNOWN');assert.equal(view.paymentStatus,'UNKNOWN');
});
test('public internal path and spoofed surface header cannot mutate Centre intake',async()=>{
 const {createEdgeWorkerHandler}=await mod('go-hub-edge-worker.mjs');let accessed=false;
 const handler=createEdgeWorkerHandler({delegate:{fetch:async()=>new Response('delegate')},factoryMcp:{fetch:async()=>new Response('mcp')}});
 const response=await handler.fetch(new Request('https://office.yggmetro.com/internal/brief/upsert',{method:'POST',headers:{'x-yggmetro-surface':'SPECTRUMSALE'},body:'{}'}),{GO_HUB_CENTRE_STATE:{getByName(){accessed=true;}}});
 assert.equal(response.status,403);assert.equal(accessed,false);
});
