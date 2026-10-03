const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const mod=name=>import(pathToFileURL(path.resolve(__dirname,'..',name)).href);

test('Office inventory reads live owners, preserves unavailable identities and paginates beyond local pins',async()=>{
  const {createOfficeOverview}=await mod('go-hub-office-overview.mjs');
  const works=Array.from({length:31},(_,i)=>({workId:'WORK-'+i,checkpointId:'CP-'+i,status:'OPEN',name:'indexed'}));
  const centre={action:async input=>input.action==='v4_inventory'?Response.json({ok:true,works,total:31,nextOffset:null,source:'CENTRE_GLOBAL_INDEX'}):input.workId==='WORK-3'?Response.json({code:'OWNER_UNAVAILABLE'},{status:503}):Response.json({work:{...works.find(w=>w.workId===input.workId),status:'WAIT CONFIRM',name:'live',result:{summary:'result'}}})};
  const result=await createOfficeOverview({centre}).works({});
  assert.equal(result.works.length,31);
  assert.equal(result.works[0].name,'live');
  assert.equal(result.works[3].status,'UNKNOWN');
  assert.equal(result.counts.waiting,30);
  assert.equal(result.counts.unknown,1);
  assert.equal(result.coverage,'INDEXED_WORKS');
});
test('Office system probes isolate failures and never expose provider secrets',async()=>{
  const {createOfficeOverview}=await mod('go-hub-office-overview.mjs');
  const view=await createOfficeOverview({probes:{Factory:async()=>({ok:true,token:'must-not-leak'}),Drive:async()=>{throw Error('secret-provider-detail')}}}).system();
  assert.equal(view.components.find(c=>c.name==='Factory').status,'LIVE');
  assert.equal(view.components.find(c=>c.name==='Drive').status,'UNKNOWN');
  assert.equal(view.components.find(c=>c.name==='PRISM').status,'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(view),/must-not-leak|secret-provider-detail/);
});
test('new overview routes require Office login',async()=>{
  const {createOfficeGate}=await mod('go-hub-office-gate.mjs');
  for(const route of ['works','system','sales']){
    const response=await createOfficeGate().fetch(new Request('https://office.example/office/api/'+route),{GOHUB_OFFICE_SESSION_KEY:'test-key'});
    assert.equal(response.status,401);
  }
});

test('Centre global inventory supports stable pages without requiring one Work ID',async()=>{
  const {createCentreLiveService,GoHubCentreState}=await mod('go-hub-centre-live.mjs');
  const map=new Map(),storage={get:async k=>map.get(k),put:async(k,v)=>map.set(k,structuredClone(v))};
  const instance=new GoHubCentreState({storage},{});
  const {createWorkRecord}=await mod('go-hub-centre-v4.js');
  for(let i=0;i<28;i++)await instance.act({action:'v4_index_replace',work:createWorkRecord({workId:'W'+i,checkpointId:'CP'+i,name:'work '+i,command:'inspect',expectedResult:'visible'})});
  const service=createCentreLiveService({namespace:{getByName:()=>instance}});
  const response=await service.action({action:'v4_inventory',limit:25,offset:0});
  const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.total,28);assert.equal(body.works.length,25);assert.equal(body.nextOffset,25);
});
