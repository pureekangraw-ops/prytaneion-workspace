// Transport receipts at Centre's SPECTRUM seam. Receipt is not processing completion.
const fail = (code,status=400) => { throw Object.assign(new Error(code),{status}); };
const id = value => /^[A-Za-z0-9:_-]{1,160}$/.test(String(value||"")) ? String(value) : fail("BRIEF_IDENTITY_REQUIRED");
const optionalId = value => String(value||"") ? id(value) : null;
const text = value => String(value||"").slice(0,4000);
const listText = (value,maxItems=12,maxLen=800) => Array.isArray(value) ? value.slice(-maxItems).map(item=>text(item).slice(0,maxLen)).filter(Boolean) : [];
function normalizeHandoff(value={}) {
  const h=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  const identity=h.identity&&typeof h.identity==="object"?h.identity:{};
  const intent=h.intent&&typeof h.intent==="object"?h.intent:{};
  const scope=h.scope&&typeof h.scope==="object"?h.scope:{};
  const commercial=h.commercial&&typeof h.commercial==="object"?h.commercial:{};
  const operations=h.operations&&typeof h.operations==="object"?h.operations:{};
  const evidence=h.evidence&&typeof h.evidence==="object"?h.evidence:{};
  const communication=h.communication&&typeof h.communication==="object"?h.communication:{};
  return {
    version:text(h.version||"1").slice(0,20),
    identity:{
      customerId:text(identity.customerId).slice(0,160),
      conversationId:text(identity.conversationId).slice(0,160),
      briefId:text(identity.briefId).slice(0,160),
      workId:text(identity.workId).slice(0,160)||null,
    },
    intent:{
      activeIntent:text(intent.activeIntent).slice(0,80)||"UNKNOWN",
      requestedResult:text(intent.requestedResult).slice(0,1200),
      customerWords:listText(intent.customerWords,8,500),
      successDefinition:text(intent.successDefinition).slice(0,800),
    },
    scope:{
      confirmedFacts:listText(scope.confirmedFacts,20,900),
      included:listText(scope.included,20,500),
      excluded:listText(scope.excluded,20,500),
      assumptions:listText(scope.assumptions,20,500),
      missingFields:listText(scope.missingFields,20,120),
      materialsReceived:text(scope.materialsReceived).slice(0,1200),
    },
    commercial:{
      packageCandidate:text(commercial.packageCandidate).slice(0,80)||null,
      priceSource:text(commercial.priceSource).slice(0,500)||null,
      paymentClaim:text(commercial.paymentClaim).slice(0,80)||"UNKNOWN",
      approvalRequired:Boolean(commercial.approvalRequired),
    },
    operations:{
      riskClass:text(operations.riskClass).slice(0,80)||"STANDARD",
      ownerSource:text(operations.ownerSource).slice(0,120)||"CENTRE_SPECTRUM_INTAKE",
      currentState:text(operations.currentState).slice(0,80)||"UNKNOWN",
      checkpointId:text(operations.checkpointId).slice(0,160)||null,
      holder:text(operations.holder).slice(0,160)||null,
      blocker:text(operations.blocker).slice(0,800)||null,
      nextAction:text(operations.nextAction).slice(0,240)||null,
      promisedUpdateAt:text(operations.promisedUpdateAt).slice(0,120)||null,
    },
    evidence:{
      eventIds:listText(evidence.eventIds,20,160),
      receipts:listText(evidence.receipts,20,500),
      readbackRefs:listText(evidence.readbackRefs,20,500),
      sourceUrls:listText(evidence.sourceUrls,20,1000),
    },
    communication:{
      lastMessage:text(communication.lastMessage).slice(0,700),
      customerEmotion:text(communication.customerEmotion).slice(0,80)||"UNKNOWN",
      responseTone:text(communication.responseTone).slice(0,80)||"WARM_STRICT",
      whatNotToRepeat:listText(communication.whatNotToRepeat,20,900),
    },
  };
}
export function createSalesStore({storage}={}) {
  const ready=()=>{if(!storage?.get||!storage?.put||!storage?.list)fail("SALES_STORE_NOT_CONFIGURED",503);};
  return {
    async brief(operation,payload={}) {
      ready();if(!["upsert","confirm"].includes(operation))fail("BRIEF_OPERATION_DENIED");
      const briefId=id(payload.briefId),clientId=id(payload.clientId),conversationId=id(payload.conversationId),requestedWorkId=optionalId(payload.workId);
      const key="spectrum:brief:"+briefId, previous=await storage.get(key);
      if(previous && (previous.clientId!==clientId || previous.conversationId!==conversationId))fail("BRIEF_IDENTITY_CONFLICT",409);
      const brief=Object.fromEntries(["goal","serviceLine","entryService","sourcePage","jobType","audience","materials","pageCount","package","desiredDate","deadlineText"].map(k=>[k,text(payload.brief?.[k])]));
      brief.sourcePage=brief.sourcePage.split(/[?#]/)[0];
      const handoff=normalizeHandoff(payload.handoff);
      if(previous?.status==="CONFIRMED") {
        if(operation==="confirm" && JSON.stringify(previous.brief)!==JSON.stringify(brief))fail("BRIEF_CONFIRM_CONFLICT",409);
        if(operation==="confirm") {
          const workId=previous.workId||requestedWorkId;
          if(workId&&!previous.workId) {
            const upgraded={...previous,workId};
            await storage.put(key,upgraded);
            return {ok:true,brief:upgraded,receipt:upgraded.receivedAt};
          }
          return {ok:true,brief:previous,receipt:previous.receivedAt};
        }
        fail("BRIEF_CONFIRMED",409);
      }
      const receivedAt=new Date().toISOString();
      const record={briefId,clientId,conversationId,workId:requestedWorkId,brief,handoff,surface:"SPECTRUMSALE",status:operation==="confirm"?"CONFIRMED":"DRAFT",stage:text(payload.stage),receivedAt,processing:"UNKNOWN",source:"CENTRE_SPECTRUM_INTAKE"};
      await storage.put(key,record);
      const saved=await storage.get(key);if(saved?.receivedAt!==receivedAt)fail("BRIEF_READBACK_FAILED",502);
      return {ok:true,brief:saved,receipt:receivedAt};
    },
    async event(payload={}) {
      ready();if(!["PAGE_VIEW","SERVICE_INTEREST","BRIEF_STARTED","CTA_CLICK"].includes(payload.type))fail("SALES_EVENT_TYPE_DENIED");
      const eventId=id(payload.eventId),key="spectrum:event:"+eventId;
      const prior=await storage.get(key);if(prior)return {ok:true,event:prior,duplicate:true};
      const record={eventId,type:payload.type,page:text(payload.page).split(/[?#]/)[0],source:text(payload.source),receivedAt:new Date().toISOString()};
      await storage.put(key,record);return {ok:true,event:record};
    },
    async list({limit=50,cursor}={}) {
      ready();const records=await storage.list({prefix:"spectrum:",limit:Math.min(100,Math.max(1,Number(limit)||50)),...(cursor?{startAfter:cursor}:{})});
      const entries=[...records], briefs=entries.filter(([k])=>k.startsWith("spectrum:brief:")).map(([,v])=>v),events=entries.filter(([k])=>k.startsWith("spectrum:event:")).map(([,v])=>v);
      return {ok:true,source:"CENTRE_SPECTRUM_INTAKE",briefs,events,coverage:"RECEIVED_RECORDS_PAGE",nextCursor:entries.length>=Math.min(100,Math.max(1,Number(limit)||50))?entries.at(-1)[0]:null,paymentStatus:"UNKNOWN",checkedAt:new Date().toISOString()};
    }
  };
}
