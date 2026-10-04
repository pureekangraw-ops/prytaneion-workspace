const fail=(code,status=502)=>{throw Object.assign(new Error(code),{status});};
const id=value=>/^[A-Za-z0-9:_-]{1,160}$/.test(String(value||""))?String(value):fail("PAYMENT_IDENTITY_REQUIRED",400);
const STATUSES=new Set(["QUOTE_DRAFT","QUOTE_SENT","PAYMENT_PENDING","PAYMENT_CONFIRMED","PAYMENT_FAILED","REFUND_PENDING","REFUNDED","DISPUTED","UNKNOWN"]);
const NEXT_ACTION=Object.freeze({QUOTE_DRAFT:"SEND_QUOTE",QUOTE_SENT:"CREATE_CHECKOUT",PAYMENT_PENDING:"WAIT_PROVIDER_CONFIRMATION",PAYMENT_CONFIRMED:"ACTIVATE_FULFILLMENT",PAYMENT_FAILED:"CONTACT_CUSTOMER",REFUND_PENDING:"WAIT_PROVIDER_REFUND",REFUNDED:"CLOSE_OR_REQUOTE",DISPUTED:"OWNER_REVIEW_REQUIRED",UNKNOWN:"VERIFY_OWNER_SOURCE"});

function httpsUrl(value){
  try{const url=new URL(String(value||""));return url.protocol==="https:"&&!url.username&&!url.password&&url.href.length<=2000?url.href:null}catch{return null}
}
function iso(value){if(value===null||value===undefined||value==='')return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null;}
function freshness(observedAt){
  if(!observedAt)return {state:"UNKNOWN",observedAt:null};
  const ageMs=Math.max(0,Date.now()-new Date(observedAt).getTime());
  return {state:ageMs<=5*60*1000?"FRESH":"STALE",observedAt,ageSeconds:Math.floor(ageMs/1000)};
}
function normalize(requested,source={}){
  const paymentId=id(source.paymentId),quoteId=id(source.quoteId),workId=id(source.workId),customerId=id(source.customerId);
  if(quoteId!==requested.quoteId||workId!==requested.workId||customerId!==requested.customerId)fail("PAYMENT_IDENTITY_MISMATCH",409);
  const status=STATUSES.has(source.status)?source.status:"UNKNOWN",providerEventId=String(source.providerEventId||"").slice(0,160)||null;
  if(status==="PAYMENT_CONFIRMED"&&!providerEventId)fail("PAYMENT_EVIDENCE_REQUIRED");
  const amount=Number(source.amount),currency=String(source.currency||"").toUpperCase();
  if(!Number.isFinite(amount)||amount<0||!/^[A-Z]{3}$/.test(currency))fail("PAYMENT_AMOUNT_INVALID");
  const checkoutUrl=httpsUrl(source.checkoutUrl);
  if(status==="PAYMENT_PENDING"&&!checkoutUrl)fail("PAYMENT_CHECKOUT_INVALID");
  const providerObservedAt=iso(source.providerObservedAt);
  if(!providerObservedAt)fail("PAYMENT_EVIDENCE_TIME_REQUIRED");
  return Object.freeze({
    paymentId,quoteId,workId,customerId,idempotencyKey:requested.idempotencyKey,
    amount,currency,status,checkoutUrl,
    providerReference:String(source.providerReference||"").slice(0,160)||null,
    providerEventId,ownerSource:"PAYMENT_PROVIDER",providerObservedAt,
    paidAt:iso(source.paidAt),failedAt:iso(source.failedAt),refundPendingAt:iso(source.refundPendingAt),refundedAt:iso(source.refundedAt),disputedAt:iso(source.disputedAt),
    fulfillmentReadiness:status==="PAYMENT_CONFIRMED"?"READY":"NOT_READY",
    evidenceFreshness:freshness(providerObservedAt),nextAction:NEXT_ACTION[status],recordedAt:new Date().toISOString(),
  });
}

export function createPaymentAdapter({binding}={}){
  return Object.freeze({
    async checkout(input={}){
      if(!binding||typeof binding.fetch!=="function")fail("PAYMENT_PROVIDER_NOT_CONFIGURED",503);
      const requested={version:"1",surface:"SPECTRUMSALE",customerId:id(input.customerId),quoteId:id(input.quoteId),workId:id(input.workId),idempotencyKey:id(input.idempotencyKey)};
      let response;try{response=await binding.fetch(new Request("https://payment-provider.internal/checkout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(requested)}));}catch{fail("PAYMENT_PROVIDER_UNAVAILABLE");}
      const body=await response.json().catch(()=>null);
      if(!response.ok||!body||typeof body!=="object"||Array.isArray(body))fail(String(body?.code||"PAYMENT_PROVIDER_REJECTED"));
      return normalize(requested,body);
    }
  });
}
