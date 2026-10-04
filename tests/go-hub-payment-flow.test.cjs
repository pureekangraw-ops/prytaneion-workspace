const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');const mod=f=>import(pathToFileURL(path.resolve(__dirname,'..',f)).href);

function namespace(Class){
 const states=new Map(),data=new Map();
 return {getByName(name){if(!states.has(name)){if(!data.has(name))data.set(name,new Map());const map=data.get(name),storage={get:async k=>structuredClone(map.get(k)),put:async(k,v)=>map.set(k,structuredClone(v)),list:async({prefix,limit=100,startAfter=''})=>new Map([...map].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit))};states.set(name,new Class({storage},{}));}return states.get(name);}};
}

async function harness(provider){
 const {createEdgeWorkerHandler}=await mod('go-hub-edge-worker.mjs');const {GoHubCentreState}=await mod('go-hub-centre-live.mjs');
 const handler=createEdgeWorkerHandler({delegate:{fetch:async()=>Response.json({code:'delegate'})},factoryMcp:{fetch:async()=>new Response('mcp')}});
 const env={GO_HUB_CENTRE_STATE:namespace(GoHubCentreState),GOHUB_OFFICE_PASSCODE:'test-passcode',GOHUB_OFFICE_SESSION_KEY:'0123456789abcdef0123456789abcdef',...(provider?{PAYMENT_PROVIDER:provider}:{})};
 return {handler,env};
}

async function officeCookie(handler,env){
 const login=await handler.fetch(new Request('https://office.example/office/login',{method:'POST',headers:{origin:'https://office.example','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({passcode:'test-passcode'})}),env);
 return login.headers.get('set-cookie').split(';')[0];
}

const checkoutRequest=()=>new Request('https://go-hub.internal/internal/payment/checkout',{method:'POST',headers:{'content-type':'application/json','x-yggmetro-surface':'SPECTRUMSALE'},body:JSON.stringify({version:'1',surface:'SPECTRUMSALE',customerId:'CLIENT-1',quoteId:'QUOTE-1',workId:'WORK-1',idempotencyKey:'CHECKOUT-1',requestedAt:'2026-10-04T22:00:00.000Z'})});

test('provider-neutral checkout persists safe owner readback for Office',async()=>{
 let providerPayload;
 const provider={fetch:async request=>{providerPayload=await request.json();return Response.json({
   paymentId:'PAY-1',quoteId:'QUOTE-1',workId:'WORK-1',customerId:'CLIENT-1',status:'PAYMENT_PENDING',amount:5900,currency:'THB',checkoutUrl:'https://checkout.provider.test/session/1',providerReference:'REF-1',providerObservedAt:new Date().toISOString(),paidAt:null,failedAt:null,refundPendingAt:null,refundedAt:null,disputedAt:null,cardNumber:'4111111111111111',secret:'must-not-survive'
 });}};
 const {handler,env}=await harness(provider);
 const checkout=await handler.fetch(checkoutRequest(),env);const body=await checkout.json();
 assert.equal(checkout.status,200);assert.equal(body.status,'PAYMENT_PENDING');assert.equal(body.checkoutUrl,'https://checkout.provider.test/session/1');
 assert.deepEqual(Object.keys(providerPayload).sort(),['customerId','idempotencyKey','quoteId','surface','version','workId']);
 const cookie=await officeCookie(handler,env);const response=await handler.fetch(new Request('https://office.example/office/api/sales',{headers:{cookie}}),env);const sales=await response.json();
 assert.equal(response.status,200);assert.equal(sales.payments.length,1);const payment=sales.payments[0];
 assert.equal(payment.customerId,'CLIENT-1');assert.equal(payment.workId,'WORK-1');assert.equal(payment.quoteId,'QUOTE-1');assert.equal(payment.amount,5900);assert.equal(payment.currency,'THB');assert.equal(payment.status,'PAYMENT_PENDING');assert.equal(payment.providerReference,'REF-1');
 assert.equal(payment.fulfillmentReadiness,'NOT_READY');assert.equal(payment.nextAction,'WAIT_PROVIDER_CONFIRMATION');assert.equal(payment.evidenceFreshness.state,'FRESH');
 assert.equal(payment.paidAt,null);assert.equal(payment.failedAt,null);assert.equal(payment.refundPendingAt,null);assert.equal(payment.refundedAt,null);assert.equal(payment.disputedAt,null);
 assert.equal(payment.cardNumber,undefined);assert.equal(payment.secret,undefined);
 const page=await handler.fetch(new Request('https://office.example/office/sales',{headers:{cookie}}),env);const html=await page.text();assert.match(html,/data-overview-payments/);assert.match(html,/การชำระเงิน/);
});

test('provider-confirmed payment without provider event evidence is rejected and not persisted',async()=>{
 const {handler,env}=await harness({fetch:async()=>Response.json({paymentId:'PAY-2',quoteId:'QUOTE-1',workId:'WORK-1',customerId:'CLIENT-1',status:'PAYMENT_CONFIRMED',amount:5900,currency:'THB',providerReference:'REF-2',providerObservedAt:new Date().toISOString()})});
 const response=await handler.fetch(checkoutRequest(),env);assert.equal(response.status,502);assert.equal((await response.json()).code,'PAYMENT_EVIDENCE_REQUIRED');
 const cookie=await officeCookie(handler,env);const sales=await (await handler.fetch(new Request('https://office.example/office/api/sales',{headers:{cookie}}),env)).json();assert.deepEqual(sales.payments,[]);
});

test('checkout fails closed when no payment provider is configured',async()=>{
 const {handler,env}=await harness();const response=await handler.fetch(checkoutRequest(),env);assert.equal(response.status,503);assert.equal((await response.json()).code,'PAYMENT_PROVIDER_NOT_CONFIGURED');
});
