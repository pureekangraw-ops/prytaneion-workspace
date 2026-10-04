import { sendPrismEyeAdmin } from './go-hub-ergasterion-transport.mjs';

const text=v=>String(v??'').trim();
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status)=>json({ok:false,code,source:'PRISM_BROWSER',evidenceLive:false},status);

export function createPrismEyeService({endpoint,secret,fetchImpl=fetch,binding=null,now=()=>Date.now()}={}){
  const transportFetch=binding?.fetch?(url,init)=>binding.fetch(new Request(url,init)):fetchImpl;
  const factoryEndpoint=text(endpoint)||(binding?.fetch?'https://ergasterion.internal':'');
  async function call(operation,input){
    const workContext={workId:text(input?.workContext?.workId),checkpointId:text(input?.workContext?.checkpointId)};
    if(!workContext.workId||!workContext.checkpointId)return fail('WORK_CONTEXT_REQUIRED',400);
    if(!factoryEndpoint||!text(secret))return fail('PRISM_FACTORY_TRANSPORT_NOT_CONFIGURED',503);
    const payload={operation,workContext};
    if(operation==='issue'){
      if(!text(input.adapterId))return fail('PRISM_ADAPTER_ID_REQUIRED',400);
      Object.assign(payload,{adapterId:text(input.adapterId),requestId:text(input.requestId)||crypto.randomUUID()});
      if(input.ttlSeconds!=null)payload.ttlSeconds=input.ttlSeconds;
    }
    if(operation==='revoke'){
      if(!text(input.sessionId))return fail('PRISM_SESSION_ID_REQUIRED',400);
      payload.sessionId=text(input.sessionId);
    }
    try {
      const body=await sendPrismEyeAdmin({endpoint:factoryEndpoint,secret,fetchImpl:transportFetch,payload});
      if(body?.ok!==true||body.source!=='PRISM_BROWSER'||body.workContext?.workId!==workContext.workId||body.workContext?.checkpointId!==workContext.checkpointId)return fail('PRISM_FACTORY_READBACK_MISMATCH',502);
      if(operation!=='latest')return json(body,operation==='issue'?201:200);
      const latest=body.latest;
      if(latest&&(latest.source!=='PRISM_BROWSER'||latest.workId!==workContext.workId||latest.checkpointId!==workContext.checkpointId))return fail('PRISM_FACTORY_READBACK_MISMATCH',502);
      const age=latest?now()-Date.parse(latest.capturedAt):null;
      const evidenceLive=body.evidenceLive===true&&age!==null&&Number.isFinite(age)&&age>=0&&age<=30000;
      return json({...body,evidenceLive,state:body.state==='LIVE'&&!evidenceLive?'STALE':body.state,workContextBound:true,legacyBrowserPolicyUsed:false,createsAuthority:false});
    }catch{return fail('PRISM_FACTORY_TRANSPORT_FAILED',502);}
  }
  return Object.freeze({latest:input=>call('latest',input),session:input=>['issue','revoke'].includes(input?.action)?call(input.action,input):Promise.resolve(fail('PRISM_SESSION_ACTION_INVALID',400))});
}
