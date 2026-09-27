import { planCloseout } from "./go-hub-housekeeper.js";
import { correlateControlRoomTruth } from "./go-hub-control-room.js";

function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json; charset=utf-8"}});}
const SAFE=new Set(["READ","PREFLIGHT","SAFE_TEST"]);
const BREAKING=new Set(["FAIL","BLOCKED","WAIT"]);
const OBSERVED_STATUS=new Set(["PASS","FAIL","BLOCKED","WAIT","UNKNOWN"]);
function text(v){return String(v??"").trim();}
function clone(v){return v==null?v:structuredClone(v);}
function requireWork(input={}){
  const w=input.work||{};
  if(text(w.status)!=="ON PROCESS"||!text(w.holder))return{ok:false,code:"MAINTENANCE_ACTIVE_WORK_REQUIRED"};
  if(w.pass?.state!=="ACTIVE"||text(w.pass?.kind).toUpperCase()!=="MAINTENANCE")return{ok:false,code:"MAINTENANCE_PASS_REQUIRED"};
  const allowed=Array.isArray(w.pass?.allowedDestinations)?w.pass.allowedDestinations:[];
  if(!allowed.includes("ALL_GO_HUB_OWNED_AREAS"))return{ok:false,code:"MAINTENANCE_SERVICE_PATH_NOT_OPEN"};
  return{ok:true,workId:w.workId,holder:w.holder};
}
function normalizeMap(map={}){
  return{
    source:text(map.source)||"GO_FIRST_REALITY_RUN",
    routes:(Array.isArray(map.routes)?map.routes:[]).map(r=>({
      id:text(r.id),from:text(r.from),to:text(r.to),
      checkpoints:(Array.isArray(r.checkpoints)?r.checkpoints:[]).map(p=>({
        id:text(p.id),importantValue:text(p.importantValue),expected:p.expected??null,
        source:text(p.source),probeAction:text(p.probeAction),mode:text(p.mode).toUpperCase()||"READ",
        ownerSource:text(p.ownerSource),evidenceRef:text(p.evidenceRef)||null,
        tags:Array.isArray(p.tags)?p.tags.map(text).filter(Boolean):[],
      })),
    })),
  };
}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function compare(expected,observed){
  if(expected==null||expected==="")return{status:"UNKNOWN",reason:"EXPECTED_NOT_DEFINED"};
  if(expected&&typeof expected==="object"&&!Array.isArray(expected)&&Array.isArray(expected.contains)){
    const vals=Array.isArray(observed)?observed:[observed];
    const missing=expected.contains.filter(v=>typeof observed==="string"?!observed.includes(String(v)):!vals.includes(v));
    return missing.length?{status:"FAIL",reason:"RELATION_MISMATCH",missing}:{status:"PASS",reason:"RELATION_PROVED"};
  }
  if(expected&&typeof expected==="object"&&!Array.isArray(expected)&&Object.hasOwn(expected,"equals"))expected=expected.equals;
  if(Array.isArray(expected))return same(expected,observed)?{status:"PASS",reason:"VALUE_PROVED"}:{status:"FAIL",reason:"VALUE_MISMATCH"};
  return Object.is(expected,observed)?{status:"PASS",reason:"VALUE_PROVED"}:{status:"FAIL",reason:"VALUE_MISMATCH"};
}
function relationView(result={}){
  if(!["RELATION_MISMATCH","VALUE_MISMATCH"].includes(result.reason))return null;
  return{type:result.reason,expected:clone(result.expected),observed:clone(result.observed),...(Array.isArray(result.missing)&&result.missing.length?{missing:clone(result.missing)}:{})};
}
async function probePoint(point,readValue,traceId,checkedAt){
  const base={checkpointId:point.id||null,importantValue:point.importantValue||null,expected:clone(point.expected),source:point.source||null,ownerSource:point.ownerSource||null,tags:clone(point.tags||[]),traceId,checkedAt};
  if(!point.id||!point.importantValue||!point.source||!point.probeAction)return{...base,status:"UNKNOWN",reason:"MAP_POINT_INCOMPLETE"};
  if(!SAFE.has(point.mode))return{...base,status:"BLOCKED",reason:"MUTATING_PROBE_FORBIDDEN"};
  try{
    const o=await readValue(point);
    if(!o||o.available===false)return{...base,observed:"UNKNOWN",status:"UNKNOWN",reason:o?.reason||"OBSERVATION_UNAVAILABLE",evidenceRef:o?.evidenceRef||o?.evidence||point.evidenceRef||null,safeEvidence:clone(o?.safeEvidence??o?.evidence??null)};
    if(OBSERVED_STATUS.has(text(o.status).toUpperCase())){
      const status=text(o.status).toUpperCase();
      return{...base,observed:clone(o.value??o.observed??null),status,reason:text(o.reason)||"SOURCE_CLASSIFICATION",evidenceRef:o.evidenceRef||point.evidenceRef||null,safeEvidence:clone(o.safeEvidence??o.evidence??null),classification:text(o.classification)||null};
    }
    const observed=clone(o.value);
    const comparison=compare(point.expected,observed);
    const result={...base,observed,evidenceRef:o.evidenceRef||o.evidence||point.evidenceRef||null,safeEvidence:clone(o.safeEvidence??o.evidence??null),classification:text(o.classification)||null,...comparison};
    const relation=relationView(result);if(relation)result.relationMismatch=relation;
    return result;
  }catch(e){
    return{...base,observed:"UNKNOWN",status:"UNKNOWN",reason:"PROBE_READ_FAILED",error:e?.message||String(e),evidenceRef:point.evidenceRef||null};
  }
}
async function probeRoute(route,readValue,traceId,checkedAt){
  const checkpoints=[];
  for(const p of route.checkpoints){
    // Keep the first-break diagnosis, but continue observing downstream points.
    // A later mismatch is evidence, not permission to hide the rest of the system.
    const r=await probePoint(p,readValue,traceId,checkedAt);
    checkpoints.push(r);
  }
  const first=checkpoints.find(x=>BREAKING.has(x.status));
  const reached=[...checkpoints].reverse().find(x=>x.status!=="NOT_CHECKED")||null;
  const unknowns=checkpoints.filter(x=>x.status==="UNKNOWN");
  return{
    routeId:route.id,from:route.from,to:route.to,status:first?first.status:(unknowns.length?"UNKNOWN":"PASS"),
    firstBreak:first?.checkpointId||null,
    firstBadValue:first?{checkpointId:first.checkpointId,importantValue:first.importantValue||null,expected:clone(first.expected),observed:clone(first.observed),reason:first.reason,relationMismatch:clone(first.relationMismatch||null),evidenceRef:first.evidenceRef||null}:null,
    reachedUntil:reached?.checkpointId||null,
    checkedCount:checkpoints.filter(x=>x.status!=="NOT_CHECKED").length,totalCheckpoints:checkpoints.length,checkpoints,
  };
}
function statusCounts(items=[]){
  const out={PASS:0,WAIT:0,BLOCKED:0,FAIL:0,UNKNOWN:0,NOT_CHECKED:0};
  for(const item of items){const s=text(item?.status).toUpperCase();if(Object.hasOwn(out,s))out[s]++;}
  return out;
}
function cartographerView(routes=[]){
  const topology=routes.map(r=>({routeId:r.routeId,from:r.from,to:r.to,status:r.status,firstBreak:r.firstBreak,reachedUntil:r.reachedUntil,checkedCount:r.checkedCount,totalCheckpoints:r.totalCheckpoints}));
  return{topology,brokenRoutes:topology.filter(r=>["FAIL","BLOCKED","WAIT"].includes(r.status)),unknownRoutes:topology.filter(r=>r.status==="UNKNOWN"),topologyGaps:topology.filter(r=>!r.from||!r.to)};
}
function ghostSignal(checkpoint={}){
  const hay=[checkpoint.checkpointId,checkpoint.importantValue,checkpoint.source,checkpoint.ownerSource,...(checkpoint.tags||[])].map(text).join(" ").toLowerCase();
  return /(legacy|compat|supersed|stale|deprecated|residue|ghost|current|authority|pointer|mirror|route)/.test(hay);
}
function ghostbustersView(routes=[]){
  const suspects=[],confirmed=[],contained=[];
  for(const route of routes)for(const cp of route.checkpoints){
    if(cp.classification==="ACTIVE_GHOST")confirmed.push({routeId:route.routeId,checkpointId:cp.checkpointId,status:cp.status,reason:cp.reason,source:cp.source,evidenceRef:cp.evidenceRef||null});
    else if(cp.classification==="CONTAINED_HISTORY")contained.push({routeId:route.routeId,checkpointId:cp.checkpointId,source:cp.source,evidenceRef:cp.evidenceRef||null});
    else if(["FAIL","UNKNOWN"].includes(cp.status)&&ghostSignal(cp))suspects.push({routeId:route.routeId,checkpointId:cp.checkpointId,status:cp.status,reason:cp.reason,source:cp.source,evidenceRef:cp.evidenceRef||null,classification:"SUSPECT_ONLY"});
  }
  return{confirmedGhosts:confirmed,residueSuspects:suspects,containedHistory:contained,confirmationRule:"CONFIRM_ONLY_WITH_POWER_TO_MISLEAD_EVIDENCE"};
}
function detectiveView(routes=[]){
  const causalLeads=[],uncertainty=[],cluster=new Map();
  for(const route of routes){
    const cps=route.checkpoints||[];
    const issueIndex=cps.findIndex(cp=>["FAIL","BLOCKED","WAIT","UNKNOWN"].includes(cp.status));
    if(issueIndex<0)continue;
    const issue=cps[issueIndex];
    const upstream=cps.slice(0,issueIndex).filter(cp=>cp.status==="PASS").map(cp=>cp.checkpointId);
    const downstream=cps.slice(issueIndex+1).filter(cp=>cp.status==="NOT_CHECKED").map(cp=>cp.checkpointId);
    causalLeads.push({
      routeId:route.routeId,symptomCheckpoint:issue.checkpointId,status:issue.status,reason:issue.reason,
      source:issue.source||null,ownerSource:issue.ownerSource||null,evidenceRef:issue.evidenceRef||null,
      upstreamProved:upstream,downstreamNotReached:downstream,
      supportedCause:issue.status==="UNKNOWN"?null:{checkpointId:issue.checkpointId,kind:issue.reason,relationMismatch:clone(issue.relationMismatch||null)},
      verdict:issue.status==="UNKNOWN"?"UNRESOLVED_OBSERVATION":"EVIDENCE_BOUND_FIRST_CAUSAL_BREAK",
      uncertainty:issue.status==="UNKNOWN"?"CAUSE_NOT_PROVED":null,
    });
    if(issue.status==="UNKNOWN")uncertainty.push({routeId:route.routeId,checkpointId:issue.checkpointId,reason:issue.reason,source:issue.source||null});
    const key=[issue.reason||"UNKNOWN",issue.source||"NO_SOURCE"].join("|");
    if(!cluster.has(key))cluster.set(key,[]);
    cluster.get(key).push({routeId:route.routeId,checkpointId:issue.checkpointId});
  }
  return{causalLeads,commonCauseCandidates:[...cluster.entries()].filter(([,items])=>items.length>1).map(([key,items])=>({signature:key,occurrences:items,classification:"COMMON_CAUSE_CANDIDATE_NOT_VERDICT"})),uncertainty,hardLock:"READ_ONLY_ZERO_MUTATION"};
}
function reportFor(map,routes,traceId,checkedAt,controlRoomTruth={}){
  const checkpoints=routes.flatMap(r=>r.checkpoints||[]);
  const routeCounts=statusCounts(routes),checkpointCounts=statusCounts(checkpoints);
  const firstBreaks=routes.filter(r=>r.firstBreak).map(r=>({routeId:r.routeId,firstBreak:r.firstBreak,reachedUntil:r.reachedUntil,firstBadValue:clone(r.firstBadValue)}));
  const unknowns=[];
  for(const route of routes)for(const cp of route.checkpoints||[])if(cp.status==="UNKNOWN")unknowns.push({routeId:route.routeId,checkpointId:cp.checkpointId,reason:cp.reason,source:cp.source||null,ownerSource:cp.ownerSource||null,evidenceRef:cp.evidenceRef||null});
  const decisionPoints=[];
  for(const route of routes)for(const cp of route.checkpoints||[])if(["FAIL","BLOCKED","WAIT","UNKNOWN"].includes(cp.status))decisionPoints.push({routeId:route.routeId,checkpointId:cp.checkpointId,status:cp.status,reason:cp.reason,importantValue:cp.importantValue||null,expected:clone(cp.expected),observed:clone(cp.observed),source:cp.source||null,ownerSource:cp.ownerSource||null,evidenceRef:cp.evidenceRef||null,relationMismatch:clone(cp.relationMismatch||null)});
  const views={cartographer:cartographerView(routes),ghostbusters:ghostbustersView(routes),detective:detectiveView(routes)};
  return{
    reportVersion:2,mapSource:map.source,traceId,checkedAt,
    coverage:{routes:{total:routes.length,...routeCounts},checkpoints:{total:checkpoints.length,...checkpointCounts},observed:checkpointCounts.PASS+checkpointCounts.FAIL+checkpointCounts.BLOCKED+checkpointCounts.WAIT,unknown:checkpointCounts.UNKNOWN,notChecked:checkpointCounts.NOT_CHECKED},
    firstBreaks,unknowns,decisionPoints,views,
    controlRoom:correlateControlRoomTruth(controlRoomTruth),
    safety:{autoRepair:false,mutationPerformed:false,probeModes:[...SAFE]},
  };
}
function memoryStorage(){const values=new Map();return{async get(k){return clone(values.get(k));},async put(k,v){values.set(k,clone(v));}};}

export function createMaintenanceV4({readValue=async()=>({available:false,reason:"READER_NOT_CONFIGURED"}),now=()=>new Date().toISOString(),traceId=()=>`maintenance-${Date.now()}`,storage=memoryStorage(),projectId="MAINTENANCE-GO-HUB"}={}){
  const STATE_KEY="maintenance.v4.state";
  return Object.freeze({
    async load(){return(await storage.get(STATE_KEY))||{projectId,map:null,lastProbe:null,revision:0};},
    async run(input={}){
      const work=requireWork(input);if(!work.ok)return json(work,409);
      const action=text(input.action).toLowerCase();
      const supplied=input.map??input.maintenanceMap??null;
      const incoming=supplied&&typeof supplied==="object"?normalizeMap(supplied):null;
      const state=await this.load();state.projectId=text(input.projectId)||state.projectId||projectId;
      const stored=state.map?normalizeMap(state.map):null;

      if(action==="inspect")return json({status:"MAINTENANCE_READY",...work,projectId:state.projectId,servicePath:"ALL_GO_HUB_OWNED_AREAS",autoRepair:false,owner:"maintenance",scannerCapabilities:["RUN_SYSTEM_CHECK","RUN_DEBUG_TEST"],mapReady:Boolean(stored?.routes?.length),mapSource:stored?.source||null,mapRoutes:stored?.routes?.length||0,lastProbe:clone(state.lastProbe),revision:Number(state.revision||0)});

      if(action==="inspect_map"){
        const hasIncoming=Boolean(incoming?.routes?.length);
        if(hasIncoming){state.map=clone(incoming);state.revision=Number(state.revision||0)+1;await storage.put(STATE_KEY,state);}
        const map=hasIncoming?incoming:(stored||incoming||normalizeMap({}));
        return json({status:"MAP_READY",...work,projectId:state.projectId,map,revision:Number(state.revision||0),persisted:Boolean(state.map?.routes?.length)});
      }

      if(["run_system_check","probe_route"].includes(action)){
        const map=(incoming?.routes?.length?incoming:stored);
        if(!map?.routes?.length)return json({code:"MAINTENANCE_MAP_NOT_READY"},409);
        if(incoming?.routes?.length)state.map=clone(incoming);
        const routes=action==="probe_route"?map.routes.filter(r=>r.id===text(input.routeId)):map.routes;
        if(!routes.length)return json({code:"ROUTE_NOT_FOUND"},404);
        const checkedAt=now(),trace=traceId(),results=[];
        for(const route of routes)results.push(await probeRoute(route,readValue,trace,checkedAt));
        const report=reportFor(map,results,trace,checkedAt,input.controlRoomTruth??input.liveTruth??input.truth??{});
        const attention=results.some(r=>["FAIL","BLOCKED","WAIT"].includes(r.status));
        state.lastProbe={traceId:trace,checkedAt,routes:clone(results),report:clone(report)};
        state.revision=Number(state.revision||0)+1;await storage.put(STATE_KEY,state);
        return json({status:attention?"MAINTENANCE_CHECK_ATTENTION":"MAINTENANCE_CHECK_COMPLETE",...work,projectId:state.projectId,traceId:trace,checkedAt,routes:results,report,views:report.views,autoRepair:false,next:attention?"GO_DIAGNOSE_REPAIR":(action==="probe_route"?"ROUTE_VERIFIED":"FULL_SYSTEM_CHECK_VERIFIED")});
      }

      if(action==="run_debug_test"){
        const checks=Array.isArray(input.checks)?input.checks:[];
        if(!checks.length)return json({code:"SYSTEM_SCANNER_CHECKS_REQUIRED"},409);
        const route=normalizeMap({
          source:"SYSTEM_SCANNER_DEBUG_TEST",
          routes:[{
            id:text(input.scanId)||"debug-test",
            from:"system-scanner",
            to:text(input.subject)||"target",
            checkpoints:checks,
          }],
        }).routes[0];
        const checkedAt=now(),trace=traceId();
        const result=await probeRoute(route,readValue,trace,checkedAt);
        const map={source:"SYSTEM_SCANNER_DEBUG_TEST",routes:[route]};
        const report=reportFor(map,[result],trace,checkedAt,input.controlRoomTruth??input.liveTruth??input.truth??{});
        const attention=["FAIL","BLOCKED","WAIT"].includes(result.status);
        const unknown=result.status==="UNKNOWN";
        state.lastProbe={traceId:trace,checkedAt,routes:[clone(result)],report:clone(report),kind:"DEBUG_TEST"};
        state.revision=Number(state.revision||0)+1;await storage.put(STATE_KEY,state);
        return json({
          status:attention?"SYSTEM_SCANNER_DEBUG_ATTENTION":unknown?"SYSTEM_SCANNER_DEBUG_UNKNOWN":"SYSTEM_SCANNER_DEBUG_COMPLETE",
          ...work,projectId:state.projectId,traceId:trace,checkedAt,
          subject:text(input.subject)||null,
          result,report,views:report.views,
          debug:{
            firstBreak:result.firstBreak||null,
            firstBadValue:clone(result.firstBadValue||null),
            reachedUntil:result.reachedUntil||null,
            unknowns:clone(report.unknowns||[]),
          },
          autoRepair:false,
          next:attention?"GO_DIAGNOSE_REPAIR":unknown?"COLLECT_MORE_EVIDENCE":"DEBUG_TEST_VERIFIED",
        });
      }

      if(action==="repair_context")return json({status:"REPAIR_CONTEXT",...work,projectId:state.projectId,servicePath:"ALL_GO_HUB_OWNED_AREAS",routeId:text(input.routeId)||null,checkpointId:text(input.checkpointId)||null,next:"GO_REPAIR_THEN_REPROBE",autoRepair:false,lastProbe:clone(state.lastProbe)});
      if(action==="plan_closeout")return json({status:"PLAN_READY",...work,projectId:state.projectId,next:"REPROBE_AFFECTED_ROUTE_THEN_FULL_SYSTEM_CHECK",plan:planCloseout(input.input||{}),autoRepair:false});
      return json({code:"MAINTENANCE_ACTION_UNAVAILABLE"},400);
    },
  });
}
export { normalizeMap, compare, reportFor, cartographerView, ghostbustersView, detectiveView };

export function createMaintenanceService(options={}){
  const v4=createMaintenanceV4(options);
  return Object.freeze({maintenance(input={}){
    if(input.work)return v4.run(input);
    const target=text(input.target),action=text(input.action).toLowerCase();
    if(target!=="factory")return json({code:"MAINTENANCE_TARGET_UNAVAILABLE"},400);
    if(action==="inspect")return json({status:"MAINTENANCE_READY",authority:"HEALTH_CLASSIFICATION_ROUTE_ONLY",mutates:false,actions:["inspect","plan_closeout"],nextRoute:"destination://factory",compatibility:"QUARANTINED"});
    if(action==="plan_closeout"){try{return json({status:"MAINTENANCE_PLAN_READY",authority:"HEALTH_CLASSIFICATION_ROUTE_ONLY",delegatedAuthority:"factory",nextRoute:"destination://factory",plan:planCloseout(input.input||{}),mutates:false,compatibility:"QUARANTINED"});}catch(error){return json({code:"MAINTENANCE_PLAN_REFUSED",message:error?.message||"plan refused"},409);}}
    return json({code:"MAINTENANCE_ACTION_UNAVAILABLE"},400);
  }});
}
