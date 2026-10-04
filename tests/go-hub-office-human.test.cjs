const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');const mod=f=>import(pathToFileURL(path.resolve(__dirname,'..',f)).href);
const env={GOHUB_OFFICE_PASSCODE:'test-passcode',GOHUB_OFFICE_SESSION_KEY:'0123456789abcdef0123456789abcdef'};
async function cookie(gate){const r=await gate.fetch(new Request('https://office.example/office/login',{method:'POST',headers:{origin:'https://office.example','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({passcode:'test-passcode'})}),env);return r.headers.get('set-cookie').split(';')[0];}
test('Office navigation opens distinct authenticated pages, rather than scrolling a diagnostic feed',async()=>{
 const {createOfficeGate}=await mod('go-hub-office-gate.mjs'),gate=createOfficeGate(),auth=await cookie(gate);
 const home=await (await gate.fetch(new Request('https://office.example/office',{headers:{cookie:auth}}),env)).text();
 assert.match(home,/href="\/office\/work"/);assert.match(home,/data-overview-activity/);assert.doesNotMatch(home,/href="#office-/);assert.doesNotMatch(home,/data-overview-system/);
 for(const [page,marker] of [['work','data-overview-works'],['results','data-overview-results'],['sales','data-overview-sales'],['files','data-office-assets']]){
  const r=await gate.fetch(new Request('https://office.example/office/'+page,{headers:{cookie:auth}}),env);assert.equal(r.status,200);const html=await r.text();assert.ok(html.includes(marker));assert.doesNotMatch(html,/data-overview-system/);
  assert.equal((await gate.fetch(new Request('https://office.example/office/'+page),env)).status,401);
 }
 const tools=await (await gate.fetch(new Request('https://office.example/office/tools',{headers:{cookie:auth}}),env)).text();assert.match(tools,/https:\/\/go-hub\.pureekangraw\.workers\.dev\/pixie-visual-workbench/);
 const system=await (await gate.fetch(new Request('https://office.example/office/system',{headers:{cookie:auth}}),env)).text();assert.match(system,/data-overview-health/);assert.match(system,/data-overview-mismatches/);
});
test('current inventory filters history before pagination and puts owner decisions first',async()=>{
 const {GoHubCentreState}=await mod('go-hub-centre-live.mjs'),{createWorkRecord}=await mod('go-hub-centre-v4.js');
 const m=new Map(),storage={get:async k=>m.get(k),put:async(k,v)=>m.set(k,structuredClone(v))},centre=new GoHubCentreState({storage},{});
 const make=(workId,status,name=workId)=>({...createWorkRecord({workId,name,command:'inspect',expectedResult:'visible'}),status});
 for(let i=0;i<30;i++)await centre.act({action:'v4_index_replace',work:make('CANCEL-'+i,'CANCEL')});
 for(const w of [make('SMOKE-1','OPEN','runtime smoke'),make('REAL-OPEN','OPEN'),make('REAL-WAIT','WAIT CONFIRM'),make('REAL-DONE','COMPLETE')])await centre.act({action:'v4_index_replace',work:w});
 const current=await (await centre.act({action:'v4_inventory',view:'current',limit:25})).json();assert.equal(current.total,2);assert.deepEqual(current.works.map(w=>w.workId),['REAL-WAIT','REAL-OPEN']);
 const results=await (await centre.act({action:'v4_inventory',view:'results'})).json();assert.deepEqual(results.works.map(w=>w.workId),['REAL-DONE']);
 const history=await (await centre.act({action:'v4_inventory',view:'history'})).json();assert.equal(history.total,32);
});
