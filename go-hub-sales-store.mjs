import { agentRuntimeDescriptor } from "./go-hub-agent-family.mjs";
// Transport receipts at Centre's SPECTRUM seam. Receipt is not processing completion.
const fail = (code,status=400) => { throw Object.assign(new Error(code),{status}); };
const id = value => /^[A-Za-z0-9:_-]{1,160}$/.test(String(value||"")) ? String(value) : fail("BRIEF_IDENTITY_REQUIRED");
const text = value => String(value||"").slice(0,4000);
export function createSalesStore({storage}={}) {
  const ready=()=>{if(!storage?.get||!storage?.put||!storage?.list)fail("SALES_STORE_NOT_CONFIGURED",503);};
  return {
    async brief(operation,payload={}) {
      ready();if(!["upsert","confirm"].includes(operation))fail("BRIEF_OPERATION_DENIED");
      const briefId=id(payload.briefId),clientId=id(payload.clientId),conversationId=id(payload.conversationId);
      const key="spectrum:brief:"+briefId, previous=await storage.get(key);
      if(previous && (previous.clientId!==clientId || previous.conversationId!==conversationId))fail("BRIEF_IDENTITY_CONFLICT",409);
      const brief=Object.fromEntries(["goal","jobType","audience","materials","pageCount","package","desiredDate","deadlineText"].map(k=>[k,text(payload.brief?.[k])]));
      if(previous?.status==="CONFIRMED") {
        if(operation==="confirm" && JSON.stringify(previous.brief)!==JSON.stringify(brief))fail("BRIEF_CONFIRM_CONFLICT",409);
        if(operation==="confirm")return {ok:true,agent:agentRuntimeDescriptor("SPECTRUM"),brief:previous,receipt:previous.receivedAt};
        fail("BRIEF_CONFIRMED",409);
      }
      const receivedAt=new Date().toISOString();
      const record={briefId,clientId,conversationId,brief,surface:"SPECTRUMSALE",status:operation==="confirm"?"CONFIRMED":"DRAFT",stage:text(payload.stage),receivedAt,processing:"UNKNOWN",source:"CENTRE_SPECTRUM_INTAKE"};
      await storage.put(key,record);
      const saved=await storage.get(key);if(saved?.receivedAt!==receivedAt)fail("BRIEF_READBACK_FAILED",502);
      return {ok:true,agent:agentRuntimeDescriptor("SPECTRUM"),brief:saved,receipt:receivedAt};
    },
    async event(payload={}) {
      ready();if(!["PAGE_VIEW","SERVICE_INTEREST","BRIEF_STARTED","CTA_CLICK"].includes(payload.type))fail("SALES_EVENT_TYPE_DENIED");
      const eventId=id(payload.eventId),key="spectrum:event:"+eventId;
      const prior=await storage.get(key);if(prior)return {ok:true,agent:agentRuntimeDescriptor("SPECTRUM"),event:prior,duplicate:true};
      const record={eventId,type:payload.type,page:text(payload.page).split(/[?#]/)[0],source:text(payload.source),receivedAt:new Date().toISOString()};
      await storage.put(key,record);return {ok:true,agent:agentRuntimeDescriptor("SPECTRUM"),event:record};
    },
    async list({limit=50,cursor}={}) {
      ready();const records=await storage.list({prefix:"spectrum:",limit:Math.min(100,Math.max(1,Number(limit)||50)),...(cursor?{startAfter:cursor}:{})});
      const entries=[...records], briefs=entries.filter(([k])=>k.startsWith("spectrum:brief:")).map(([,v])=>v),events=entries.filter(([k])=>k.startsWith("spectrum:event:")).map(([,v])=>v);
      return {ok:true,agent:agentRuntimeDescriptor("SPECTRUM"),source:"CENTRE_SPECTRUM_INTAKE",briefs,events,coverage:"RECEIVED_RECORDS_PAGE",nextCursor:entries.length>=Math.min(100,Math.max(1,Number(limit)||50))?entries.at(-1)[0]:null,paymentStatus:"UNKNOWN",checkedAt:new Date().toISOString()};
    }
  };
}
