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
  for(const route of ['works','activity','health','system','sales','summary']){
    const response=await createOfficeGate().fetch(new Request('https://office.example/office/api/'+route),{GOHUB_OFFICE_SESSION_KEY:'test-key'});
    assert.equal(response.status,401);
  }
});

test('authenticated summary route dispatches only to dailySummary',async()=>{
  const {createOfficeGate}=await mod('go-hub-office-gate.mjs');
  const currentEnv={GOHUB_OFFICE_PASSCODE:'office-secret',GOHUB_OFFICE_SESSION_KEY:'0123456789abcdef0123456789abcdef',GOHUB_OFFICE_SESSION_EPOCH:'7'};
  let calls=0;
  const gate=createOfficeGate({overview:{dailySummary:async()=>{calls++;return {ok:true,authority:'READ_ONLY'};}}});
  const login=await gate.fetch(new Request('https://office.example/office/login',{method:'POST',headers:{origin:'https://office.example','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({passcode:'office-secret'})}),currentEnv);
  const cookie=(login.headers.get('set-cookie')||'').split(';')[0];
  const response=await gate.fetch(new Request('https://office.example/office/api/summary',{headers:{cookie}}),currentEnv);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,authority:'READ_ONLY'});
  assert.equal(calls,1);
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

test('Office activity and health turn Work truth into owner-visible movement and mismatch signals',async()=>{
  const {createOfficeOverview}=await mod('go-hub-office-overview.mjs');
  const works=[
    {workId:'W1',checkpointId:'CP1',status:'ON PROCESS',name:'งานหนึ่ง',holder:'GO',lastUpdated:'2026-10-04T01:00:00.000Z'},
    {workId:'W2',checkpointId:'CP2',status:'ON PROCESS',name:'งานสอง',holder:null,lastUpdated:'2026-10-04T02:00:00.000Z'},
    {workId:'W3',checkpointId:'CP3',status:'WAIT CONFIRM',name:'งานสาม',holder:'GO',lastUpdated:'2026-10-04T03:00:00.000Z',waitReason:'รอบิ๊กตรวจ'},
  ];
  const centre={action:async input=>input.action==='v4_inventory'
    ?Response.json({ok:true,works,total:works.length,nextOffset:null})
    :Response.json({work:works.find(w=>w.workId===input.workId)})};
  const office=createOfficeOverview({centre});
  const activity=await office.activity({limit:2});
  assert.deepEqual(activity.items.map(i=>i.workId),['W3','W2']);
  assert.match(activity.items[0].movement,/รอ:/);
  const health=await office.health();
  assert.equal(health.state,'ATTENTION');
  assert.equal(health.counts.mismatches,1);
  assert.equal(health.mismatches[0].kind,'OWNER_MISSING');
});

test('Office daily summary separates currencies and routes consequential payment evidence to GO review',async()=>{
  const {createOfficeOverview}=await mod('go-hub-office-overview.mjs');
  const works=[
    {workId:'W1',checkpointId:'CP1',status:'ON PROCESS',name:'งานหนึ่ง',holder:'GO'},
    {workId:'W2',checkpointId:'CP2',status:'WAIT CONFIRM',name:'งานสอง',holder:'GO'},
    {workId:'W3',checkpointId:'CP3',status:'UNKNOWN',name:'งานสาม'},
  ];
  const payments=[
    {paymentId:'P1',status:'PAYMENT_CONFIRMED',amount:5900,currency:'THB',providerReference:'REF-1',evidenceFreshness:{state:'FRESH'},cardNumber:'4111111111111111'},
    {paymentId:'P2',status:'PAYMENT_CONFIRMED',amount:100,currency:'USD',providerReference:'REF-2',evidenceFreshness:{state:'FRESH'}},
    {paymentId:'P3',status:'PAYMENT_PENDING',amount:1200,currency:'THB',providerReference:'REF-3',evidenceFreshness:{state:'FRESH'}},
    {paymentId:'P4',status:'DISPUTED',amount:800,currency:'THB',providerReference:'REF-4',evidenceFreshness:{state:'STALE'}},
  ];
  const centre={action:async input=>{
    if(input.action==='v4_inventory')return Response.json({ok:true,works,total:works.length,nextOffset:null});
    if(input.action==='v4_inspect')return Response.json({work:works.find(w=>w.workId===input.workId)});
    if(input.action==='spectrum_list')return Response.json({ok:true,briefs:[{briefId:'B1'}],events:[],source:'CENTRE_SPECTRUM_INTAKE'});
    if(input.action==='quote_list')return Response.json({ok:true,quotes:[{quoteId:'Q1',status:'QUOTE_DRAFT'},{quoteId:'Q2',status:'QUOTE_SENT'}],source:'OFFICE_OWNER'});
    if(input.action==='payment_list')return Response.json({ok:true,payments,source:'PROVIDER_ADAPTER',nextCursor:'payment:record:next'});
    throw Error('unexpected action '+input.action);
  }};
  const summary=await createOfficeOverview({centre,probes:{Centre:async()=>({ok:true})}}).dailySummary();
  assert.deepEqual(summary.work,{active:1,waiting:1,attention:0,unknown:1,total:3,observed:3,coverageComplete:true});
  assert.deepEqual(summary.sales,{briefsReceived:1,quoteDrafts:1,quotesSent:1,coverageComplete:true});
  assert.deepEqual(summary.money.providerConfirmedByCurrency,{THB:5900,USD:100});
  assert.equal(summary.money.pending,1);
  assert.equal(summary.money.goReviewRequired,3);
  assert.equal(summary.money.authority,'GO_REVIEW_REQUIRED');
  assert.equal(summary.money.coverageComplete,false);
  assert.deepEqual(summary.system,{live:1,unknown:10,total:11});
  assert.equal(summary.attention.total,5);
  assert.equal(summary.attention.coverageIncomplete,1);
  assert.equal(summary.attention.nextAction,'GO_REVIEW');
  assert.doesNotMatch(JSON.stringify(summary),/4111111111111111/);
});

test('Office home presents the five daily summary lenses before operational detail',async()=>{
  const {officeShell}=await mod('go-hub-office-shell.mjs');
  const html=officeShell('home');
  assert.match(html,/data-daily-summary/);
  for(const lens of ['SALES','MONEY','WORK','SYSTEM','ATTENTION'])assert.match(html,new RegExp('data-summary-lens="'+lens+'"'));
  assert.ok(html.indexOf('data-daily-summary')<html.indexOf('office-launch-grid'));
  assert.match(html,/GO review/);
  assert.match(html,/ภาพรวมปัจจุบัน/);
  assert.match(html,/aria-live="polite"/);
});
