const LOCAL_CAPABILITIES=Object.freeze([
  "PAGE_SCAN",
  "PAGE_FINGERPRINT",
  "SAFE_FILL_PREVIEW",
  "SAFE_FILL_EXECUTE",
  "LOCAL_OBSERVER_SNAPSHOT",
  "SCREENSHOT_WITH_LOCAL_CONSENT",
  "SITE_PROFILE_POLICY",
  "LOCAL_NOTES",
  "LOCAL_TRACKED_WORK_REFS",
  "LAST_GOOD_EVIDENCE",
  "LOCAL_OUTBOX"
]);

const GOVERNED_CAPABILITIES=Object.freeze([
  "CENTRE_WORK_TRUTH",
  "PASS_PERMISSION",
  "COUNTER_SHARED_TRUTH",
  "MERGE",
  "DEPLOY",
  "SHARED_AUDIT",
  "REMOTE_MUTATION"
]);

const clean=value=>String(value??"").trim();

function clone(value){return value==null?value:structuredClone(value);}

export function createPrismLocalRuntime({storage,now=()=>Date.now()}={}){
  if(!storage||typeof storage.get!=="function"||typeof storage.put!=="function"){
    throw new TypeError("PRISM_LOCAL_STORAGE_REQUIRED");
  }
  const keys=Object.freeze({
    workspace:"prism.local.workspace.v1",
    evidence:"prism.local.evidence.v1",
    outbox:"prism.local.outbox.v1",
  });
  async function read(key,fallback){
    const value=await storage.get(key);
    return value==null?clone(fallback):clone(value);
  }
  async function write(key,value){await storage.put(key,clone(value));return clone(value);}
  async function workspace(){
    return read(keys.workspace,{notes:[],trackedWork:[],context:{},updatedAt:null});
  }
  async function updateWorkspace(patch={}){
    const current=await workspace();
    const next={
      ...current,
      ...(patch.context?{context:{...current.context,...patch.context}}:{}),
      ...(Array.isArray(patch.notes)?{notes:patch.notes.slice(-100)}:{}),
      ...(Array.isArray(patch.trackedWork)?{trackedWork:patch.trackedWork.slice(-100)}:{}),
      updatedAt:new Date(now()).toISOString(),
    };
    return write(keys.workspace,next);
  }
  async function rememberEvidence(evidence){
    const list=await read(keys.evidence,[]);
    const item={...clone(evidence),capturedAt:clean(evidence?.capturedAt)||new Date(now()).toISOString(),source:"PRISM_LOCAL",createsAuthority:false};
    list.push(item);
    await write(keys.evidence,list.slice(-100));
    return item;
  }
  async function evidence(){return read(keys.evidence,[]);}
  async function queueGovernedRequest(request){
    const capability=clean(request?.capability).toUpperCase();
    if(!GOVERNED_CAPABILITIES.includes(capability))throw new Error("PRISM_OUTBOX_GOVERNED_CAPABILITY_REQUIRED");
    const list=await read(keys.outbox,[]);
    const item={
      id:clean(request?.id)||("PRISM-OUTBOX-"+now()),
      capability,
      payload:clone(request?.payload||{}),
      state:"NOT_EXECUTED",
      queuedAt:new Date(now()).toISOString(),
    };
    list.push(item);
    await write(keys.outbox,list.slice(-100));
    return item;
  }
  async function outbox(){return read(keys.outbox,[]);}
  function capability(name){
    const id=clean(name).toUpperCase();
    if(LOCAL_CAPABILITIES.includes(id))return Object.freeze({id,mode:"LOCAL",available:true,createsAuthority:false});
    if(GOVERNED_CAPABILITIES.includes(id))return Object.freeze({id,mode:"GOVERNED",available:false,createsAuthority:false});
    return Object.freeze({id,mode:"UNKNOWN",available:false,createsAuthority:false});
  }
  return Object.freeze({capability,workspace,updateWorkspace,rememberEvidence,evidence,queueGovernedRequest,outbox});
}

export const PRISM_LOCAL_CAPABILITY_CONTRACT=Object.freeze({
  version:"prism-local-capabilities-v1",
  local:LOCAL_CAPABILITIES,
  governed:GOVERNED_CAPABILITIES,
  rule:"LOCAL does not create shared authority; governed requests stay NOT_EXECUTED until a backend authority path runs them."
});

export const PRISM_OFFLOAD_CONTRACT=Object.freeze({
  version:"prism-offload-v1",
  localPreferred:["PAGE_SCAN","PAGE_FINGERPRINT","SAFE_FILL_PREVIEW","SAFE_FILL_EXECUTE","LOCAL_OBSERVER_SNAPSHOT","SCREENSHOT_WITH_LOCAL_CONSENT"],
  remotePreferred:["PIXIE_VISUAL_RENDER","MEDIA_RENDER","BUILD","CI"],
  governedOnly:["CENTRE_WORK_TRUTH","PASS_PERMISSION","COUNTER_SHARED_TRUTH","MERGE","DEPLOY","SHARED_AUDIT","REMOTE_MUTATION"],
  rule:"Heavy compute may be offloaded, but remote execution does not grant authority or change central truth by itself."
});
