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
