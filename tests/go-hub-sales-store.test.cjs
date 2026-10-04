const test=require('node:test');const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');const path=require('node:path');
const load=()=>import(pathToFileURL(path.resolve(__dirname,'../go-hub-sales-store.mjs')).href);
function bucket(){const data=new Map();return {get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),list:async({prefix})=>new Map([...data].filter(([k])=>k.startsWith(prefix)))};}
const brief={briefId:'BRIEF-1',clientId:'CLIENT-1',conversationId:'CONV-1',brief:{goal:'Pitch',jobType:'PROPOSAL'}};
test('sales brief survives service recreation, confirmation locks snapshot and identity',async()=>{
 const {createSalesStore}=await load(),b=bucket();
 await createSalesStore({storage:b}).brief('upsert',brief);
 const store=createSalesStore({storage:b});await store.brief('confirm',brief);
 assert.equal((await store.list()).briefs[0].status,'CONFIRMED');
 await assert.rejects(()=>store.brief('upsert',{...brief,brief:{goal:'overwrite'}}),/BRIEF_CONFIRMED/);
 await assert.rejects(()=>store.brief('confirm',{...brief,clientId:'other'}),/BRIEF_IDENTITY_CONFLICT/);
 await assert.rejects(()=>store.brief('confirm',{...brief,brief:{goal:'changed'}}),/BRIEF_CONFIRM_CONFLICT/);
 assert.equal((await store.list()).briefs[0].brief.goal,'Pitch');
});
test('sales public observations cannot fabricate paid orders and duplicate events count once',async()=>{
 const {createSalesStore}=await load(),store=createSalesStore({storage:bucket()});
 const event={eventId:'EV-1',type:'PAGE_VIEW',page:'/',source:'direct'};
 await store.event(event);await store.event(event);
 assert.equal((await store.list()).events.length,1);
 await assert.rejects(()=>store.event({...event,eventId:'EV-paid',type:'PAYMENT_CONFIRMED'}),/SALES_EVENT_TYPE_DENIED/);
});
test('missing sales storage reports unavailable instead of an empty successful funnel',async()=>{
 const {createSalesStore}=await load();await assert.rejects(()=>createSalesStore().list(),/SALES_STORE_NOT_CONFIGURED/);
});


test('SPECTRUM storefront context survives Centre intake and strips query fragments',async()=>{
 const {createSalesStore}=await load(),store=createSalesStore({storage:bucket()});
 await store.brief('upsert',{
   briefId:'BRIEF-SVC-1',clientId:'CLIENT-SVC-1',conversationId:'CONV-SVC-1',
   brief:{goal:'New web',serviceLine:'DIGITAL',entryService:'digital',sourcePage:'/client?service=digital#top',jobType:'WEB_EXPERIENCE'}
 });
 const saved=(await store.list()).briefs[0].brief;
 assert.equal(saved.serviceLine,'DIGITAL');
 assert.equal(saved.entryService,'digital');
 assert.equal(saved.sourcePage,'/client');
 assert.equal(saved.jobType,'WEB_EXPERIENCE');
});


test('confirmed SPECTRUM brief persists bounded handoff packet',async()=>{
 const {createSalesStore}=await load(),store=createSalesStore({storage:bucket()});
 await store.brief('confirm',{
   briefId:'BRIEF-HANDOFF-1',clientId:'CLIENT-HANDOFF-1',conversationId:'CONV-HANDOFF-1',
   brief:{goal:'Pitch deck',jobType:'PROPOSAL',materials:'มีไฟล์เดิม'},
   handoff:{
     version:'1',
     identity:{customerId:'CLIENT-HANDOFF-1',conversationId:'CONV-HANDOFF-1',briefId:'BRIEF-HANDOFF-1'},
     intent:{activeIntent:'PRE_ESTIMATE',requestedResult:'Pitch deck',customerWords:['อยากทำ pitch deck','อยากประเมินก่อน'],successDefinition:'ทีมรับช่วงได้โดยไม่ต้องเล่าซ้ำ'},
     scope:{confirmedFacts:['goal=Pitch deck'],missingFields:['audience'],materialsReceived:'มีไฟล์เดิม'},
     commercial:{packageCandidate:'STANDARD',priceSource:null,paymentClaim:'UNKNOWN',approvalRequired:true},
     operations:{riskClass:'COMMERCIAL_REVIEW',ownerSource:'CENTRE_SPECTRUM_INTAKE',currentState:'CONFIRMED',nextAction:'TEAM_REVIEW'},
     communication:{lastMessage:'อยากประเมินก่อน',customerEmotion:'UNKNOWN',responseTone:'WARM_STRICT',whatNotToRepeat:['goal=Pitch deck']}
   }
 });
 const saved=(await store.list()).briefs[0];
 assert.equal(saved.handoff.identity.briefId,'BRIEF-HANDOFF-1');
 assert.equal(saved.handoff.intent.activeIntent,'PRE_ESTIMATE');
 assert.equal(saved.handoff.commercial.paymentClaim,'UNKNOWN');
 assert.equal(saved.handoff.commercial.approvalRequired,true);
 assert.equal(saved.handoff.operations.nextAction,'TEAM_REVIEW');
 assert.deepEqual(saved.handoff.intent.customerWords,['อยากทำ pitch deck','อยากประเมินก่อน']);
});

test('handoff packet remains immutable on idempotent confirm retry',async()=>{
 const {createSalesStore}=await load(),store=createSalesStore({storage:bucket()});
 const base={
   briefId:'BRIEF-HANDOFF-2',clientId:'CLIENT-HANDOFF-2',conversationId:'CONV-HANDOFF-2',
   brief:{goal:'Brand system',jobType:'BRAND_VISUAL_SYSTEM'},
   handoff:{intent:{activeIntent:'START',customerWords:['เริ่มงานแบรนด์']},operations:{currentState:'CONFIRMED',nextAction:'TEAM_REVIEW'}}
 };
 const first=await store.brief('confirm',base);
 const second=await store.brief('confirm',{...base,handoff:{intent:{activeIntent:'HELP',customerWords:['ข้อความใหม่']}}});
 assert.equal(second.receipt,first.receipt);
 const saved=(await store.list()).briefs[0];
 assert.equal(saved.handoff.intent.activeIntent,'START');
 assert.deepEqual(saved.handoff.intent.customerWords,['เริ่มงานแบรนด์']);
});
