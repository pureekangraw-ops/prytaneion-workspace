const clean=v=>String(v??'').trim();
const fail=(code,status=400)=>Object.assign(Error(code),{status});
export function createPrismControlPortService({centre,counter,lifecycle,notionLight}={}) {
  async function workContext(body){
    const workId=clean(body.workId),checkpointId=clean(body.checkpointId);
    if(!workId||!checkpointId)throw fail('PRISM_WORK_CONTEXT_REQUIRED');
    const response=await centre.action({action:'v4_inspect',workId});
    if(!response.ok)throw fail('PRISM_WORK_UNAVAILABLE',response.status);
    const current=await response.json();
    if(current.work?.workId!==workId||current.work?.checkpointId!==checkpointId)throw fail('PRISM_WORK_CONTEXT_MISMATCH',409);
    if(['COMPLETE','CANCEL','RETURNED'].includes(current.work.status))throw fail('PRISM_WORK_TERMINAL',409);
    return {workId,checkpointId,returnAddress:checkpointId};
  }
  return Object.freeze({async handle(action,body){
    if(action==='ask') {
      const question=clean(body.question);if(!question||question.length>4000)throw fail('PRISM_QUESTION_INVALID');
      const response=await notionLight.search({query:question});if(!response.ok)return response;
      const data=await response.json();
      if(data.ok===false)return Response.json(data,{status:502});
      return Response.json({ok:true,kind:'SEARCH',summary:'พบ '+String(data.resultCount??data.evidence?.length??0)+' ผลค้นจาก LIGHT / Notion',result:data});
    }
    const context=await workContext(body);
    if(action==='result'){
      const id=clean(body.counterId);if(!/^COUNTER-PRISM-[a-f0-9]{64}$/.test(id))throw fail('PRISM_RECEIPT_INVALID');
      const response=await counter.get({counterId:id,workContext:context});if(!response.ok)return response;
      const data=await response.json(),ticket=data.counter||{};
      if(ticket.context?.source!=='PRISM_OWNER')throw fail('PRISM_RECEIPT_SOURCE_MISMATCH',403);
      return Response.json({ok:true,counterId:id,...context,status:ticket.currentState||'UNKNOWN',summary:typeof ticket.answer==='string'?ticket.answer:JSON.stringify(ticket.answer??null),evidence:ticket.evidence||[]});
    }
    if(action!=='handoff')throw fail('PRISM_ROUTE_UNSUPPORTED',404);
    // The existing GO-origin Counter route supports LIGHT; no actor impersonation.
    if(clean(body.destination).toUpperCase()!=='LIGHT')throw fail('PRISM_DESTINATION_NOT_CONNECTED',409);
    const requestedResult=clean(body.requestedResult),message=clean(body.message);
    if(!requestedResult||requestedResult.length>4000||message.length>4000)throw fail('PRISM_REQUEST_INVALID');
    const identity=JSON.stringify({...context,destination:'LIGHT',requestedResult,message});
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const counterId='COUNTER-PRISM-'+hash;
    const response=await lifecycle.create({counterId,mode:'HANDOFF',fromActor:'GO',toActor:'LIGHT',request:message||requestedResult,requestedResult,authority:'BIG',workContext:context,context:{source:'PRISM_OWNER'},doNotChange:['Do not create a new Work or Checkpoint']});
    if(!response.ok)return response;
    const data=await response.json();
    const blocked=Boolean(data.dispatchCode||data.lightAuthRequired||data.lightCapabilityBlocked);
    return Response.json({ok:true,counterId,...context,status:blocked?'BLOCKED':data.counter?.currentState==='ANSWERED'?'ANSWERED':'QUEUED',summary:blocked?'ฮับเก็บ Handoff แล้ว แต่ส่งให้ LIGHT ยังไม่ได้: '+String(data.dispatchCode||'LIGHT_NOT_READY'):'ฮับรับ Handoff ให้ LIGHT แล้ว รอผลตอบกลับ',evidence:[],dispatch:data.dispatch||null});
  }});
}
