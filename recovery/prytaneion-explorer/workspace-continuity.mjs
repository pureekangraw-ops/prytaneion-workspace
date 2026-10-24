import {createGoogleDriveService} from '../../go-hub-google-drive-service.mjs';
const ROOT='1z7oD62E_zdJe9gbl6ZoA4brtcoPeykSq';
const CHECKPOINTS='1zXE9WehOb_dE1M53wUfb6AipWaIs-auK';
const provenance=Object.freeze({evidence:'CALLER_DECLARED',liveIdentity:'CALLER_DECLARED_NOT_VERIFIED',currentWriter:'LOGICAL_LABEL_NOT_AUTHENTICATED_ACTOR'});
const fail=code=>{throw Error(code)};
const canonical=v=>JSON.stringify(sort(v));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export async function hash(v){const bytes=typeof v==='string'?new TextEncoder().encode(v):new TextEncoder().encode(canonical(v));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('WORKSPACE_INVALID_INPUT');}
function str(v,max=200){if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f]/.test(v))fail('WORKSPACE_INVALID_INPUT');}
function ident(v){if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))fail('WORKSPACE_INVALID_INPUT');}
function fileId(v){if(typeof v!=='string'||!/^[A-Za-z0-9_-]{10,160}$/.test(v))fail('WORKSPACE_INVALID_INPUT');}
function integer(v){if(!Number.isSafeInteger(v)||v<0)fail('WORKSPACE_INVALID_INPUT');}
function manifest(m,config){
 exact(m,['workId','zone','blueprintVersion','source','live','currentWriter','writerEpoch','checkpoint','evidence','artifact','nextAction']);
 if(m.workId!==config.workId)fail('WORKSPACE_SCOPE_DENIED');
 str(m.zone,60);str(m.blueprintVersion,80);ident(m.currentWriter);integer(m.writerEpoch);str(m.checkpoint,200);str(m.nextAction,1000);
 if(!config.writers.includes(m.currentWriter))fail('WORKSPACE_WRITER_DENIED');
 exact(m.source,['repo','branch','commit']);str(m.source.repo,300);str(m.source.branch,160);
 if(!/^[a-f0-9]{40}$/.test(m.source.commit))fail('WORKSPACE_INVALID_INPUT');
 if(m.live!==null){exact(m.live,['sourceCommit','deploymentVersion','evidenceRef']);if(!/^[a-f0-9]{40}$/.test(m.live.sourceCommit))fail('WORKSPACE_INVALID_INPUT');str(m.live.deploymentVersion);str(m.live.evidenceRef,500);}
 if(!Array.isArray(m.evidence)||m.evidence.length>16)fail('WORKSPACE_INVALID_INPUT');
 for(const e of m.evidence){exact(e,['status','reference','scope']);if(!['VERIFIED','PENDING','FAILED','UNKNOWN'].includes(e.status))fail('WORKSPACE_INVALID_INPUT');str(e.reference,500);str(e.scope,500);}
 if(m.artifact!==null){exact(m.artifact,['reference','sha256']);str(m.artifact.reference,500);if(!/^[a-f0-9]{64}$/.test(m.artifact.sha256))fail('WORKSPACE_INVALID_INPUT');}
}
// This is a bounded append-only storage contract, not an executor or queue.
// The trusted owner chooses logical writer labels; they are not identity tokens.
export function createContinuity({store,config,clock=()=>new Date().toISOString()}){
 exact(config,['workId','rootFileId','initialWriter','writers']);ident(config.workId);fileId(config.rootFileId);ident(config.initialWriter);
 if(!Array.isArray(config.writers)||config.writers.length<1||config.writers.length>8||!config.writers.includes(config.initialWriter))fail('WORKSPACE_NOT_CONFIGURED');config.writers.forEach(ident);
 async function scan(){
  const history=[];const seen=new Set();let target=config.rootFileId,previous=null;
  for(let i=0;i<64;i++){
   if(seen.has(target))fail('WORKSPACE_CHAIN_INVALID');seen.add(target);
   // Drive404 also means unreadable: this is only a visible prefix, never a proven head.
   const wrapper=await store.read(target);if(!wrapper)return {history,nextFileId:target};
   const {record,sha256}=wrapper;
   if(!record||sha256!==await hash(record)||record.workId!==config.workId||record.version!==i+1||record.previousHash!==previous)fail('WORKSPACE_CHAIN_INVALID');
   manifest(record.manifest,config);fileId(record.nextFileId);
   if(record.artifactText!==null&&(typeof record.artifactText!=='string'||record.artifactText.length>16384||!record.manifest.artifact||await hash(record.artifactText)!==record.manifest.artifact.sha256))fail('WORKSPACE_ARTIFACT_MISMATCH');
   history.push({...wrapper,fileId:target,manifestHash:await hash(record.manifest)});previous=sha256;target=record.nextFileId;
  }
  fail('WORKSPACE_HISTORY_LIMIT');
 }
 const receipt=row=>({requestId:row.record.requestId,workId:config.workId,version:row.record.version,fileId:row.fileId,manifestHash:row.manifestHash,recordHash:row.sha256,provenance,artifactHash:row.record.manifest.artifact?.sha256||null,artifactReadback:row.record.artifactText===null?'REFERENCE_ONLY_UNVERIFIED':'INLINE_SHA256_VERIFIED',status:'STORED_READBACK_VERIFIED',execution:'NOT_ASSERTED'});
 async function read({workId,version,minimumVersion=0}={}){
  integer(minimumVersion);
  if(workId!==config.workId)fail('WORKSPACE_SCOPE_DENIED');if(version!==undefined){integer(version);if(version<1)fail('WORKSPACE_INVALID_INPUT');}
  const {history}=await scan();const visibleVersion=history.at(-1)?.record.version||0;
  const unknown={provenance,status:'UNKNOWN',reason:'ABSENT_OR_UNREADABLE',workId,visibleVersion,latest:'UNKNOWN'};
  if(visibleVersion<minimumVersion)return {...unknown,reason:'KNOWN_VERSION_NOT_VISIBLE',minimumVersion};
  const row=version===undefined?history.at(-1):history.find(r=>r.record.version===version);
  if(!row)return unknown;
  return {provenance,status:version===undefined?'VISIBLE_PREFIX':'EXACT_VERSION',latest:'UNKNOWN',manifest:row.record.manifest,artifactText:row.record.artifactText,receipt:receipt(row)};
 }
 async function write(input){
  exact(input,['workId','writeRequestId','writer','expectedVersion','expectedEpoch','manifest','artifactText','approved']);
  if(input.approved!==true)fail('WORKSPACE_APPROVAL_REQUIRED');if(input.workId!==config.workId)fail('WORKSPACE_SCOPE_DENIED');
  ident(input.writeRequestId);ident(input.writer);integer(input.expectedVersion);integer(input.expectedEpoch);manifest(input.manifest,config);
  if(input.artifactText!==null&&(typeof input.artifactText!=='string'||input.artifactText.length>16384||!input.manifest.artifact||await hash(input.artifactText)!==input.manifest.artifact.sha256))fail('WORKSPACE_ARTIFACT_MISMATCH');
  const requestHash=await hash(input),{history,nextFileId}=await scan();
  const prior=history.find(r=>r.record.requestId===input.writeRequestId);
  if(prior){if(prior.record.requestHash!==requestHash)fail('WORKSPACE_IDEMPOTENCY_CONFLICT');return {...await read({workId:config.workId,version:prior.record.version}),duplicate:true};}
  const last=history.at(-1),version=last?.record.version||0,old=last?.record.manifest;
  if(version>=63)fail('WORKSPACE_HISTORY_LIMIT');
  if(version!==input.expectedVersion)fail('WORKSPACE_VERSION_CONFLICT');
  if(input.writer!==(old?.currentWriter||config.initialWriter)||input.expectedEpoch!==(old?.writerEpoch||0))fail('WORKSPACE_STALE_WRITER');
  const handoff=input.manifest.currentWriter!==input.writer;
  if(input.manifest.writerEpoch!==input.expectedEpoch+(handoff?1:0))fail('WORKSPACE_STALE_WRITER');
  // Both contenders MUST create this same slot. Reading version alone is not CAS.
  const record={workId:config.workId,version:version+1,requestId:input.writeRequestId,requestHash,previousHash:last?.sha256||null,
   nextFileId:await store.allocate(),manifest:input.manifest,artifactText:input.artifactText,storedAt:clock()};
  const wrapper={record,sha256:await hash(record)};
  try{await store.create(nextFileId,wrapper);}catch{ // reconcile once; never blindly retry or choose a new slot
   let found;try{found=await store.read(nextFileId);}catch{fail('WORKSPACE_WRITE_UNCERTAIN');}
   if(!found)fail('WORKSPACE_WRITE_UNCERTAIN');
  }
  const {history:verified}=await scan();const row=verified.find(r=>r.fileId===nextFileId);
  if(!row)fail('WORKSPACE_WRITE_UNCERTAIN');
  if(row.record.requestId!==input.writeRequestId||row.record.requestHash!==requestHash)fail('WORKSPACE_VERSION_CONFLICT');
  return read({workId:config.workId,version:row.record.version});
 }
 async function getReceipt({workId,writeRequestId:requestId}){if(workId!==config.workId)fail('WORKSPACE_SCOPE_DENIED');ident(requestId);const {history}=await scan();const row=history.find(r=>r.record.requestId===requestId);return row?receipt(row):{provenance,status:'UNKNOWN',reason:'ABSENT_OR_UNREADABLE',workId,requestId};}
 return {read,write,receipt:getReceipt};
}
export function workspaceAdapter(env,fetcher){
 let config;try{config=JSON.parse(env.WORKSPACE_CONTINUITY_CONFIG);}catch{fail('WORKSPACE_NOT_CONFIGURED');}
 const drive=createGoogleDriveService({fetchImpl:(url,init)=>fetcher(url,{...init,redirect:'manual'}),rootFolderId:ROOT,
  accessToken:env.GO_HUB_DIRECT_GOOGLE_ACCESS_TOKEN,clientId:env.GO_HUB_DIRECT_GOOGLE_CLIENT_ID,
  clientSecret:env.GO_HUB_DIRECT_GOOGLE_CLIENT_SECRET,refreshToken:env.GO_HUB_DIRECT_GOOGLE_REFRESH_TOKEN});
 return createContinuity({config,store:drive.continuityStore({folderId:CHECKPOINTS})});
}
export const WORKSPACE_TOOLS=[
 {name:'google_workspace_read',description:'Read visible prefix or exact version, never assert latest. Pass minimumVersion from a known receipt to prevent regression; no execution.',inputSchema:{type:'object',properties:{workId:{type:'string'},version:{type:'integer',minimum:1},minimumVersion:{type:'integer',minimum:0}},required:['workId'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'google_workspace_receipt',description:'Reconcile an exact continuity write request. An invisible request is UNKNOWN, not absent. A stored receipt does not prove execution.',inputSchema:{type:'object',properties:{workId:{type:'string'},writeRequestId:{type:'string'}},required:['workId','writeRequestId'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'google_workspace_write',description:'Owner-approved append-only checkpoint/handoff for one configured work. Never executes GO or changes existing Drive files. Reconcile uncertain writes before retry.',inputSchema:{type:'object',properties:{workId:{type:'string'},writeRequestId:{type:'string'},writer:{type:'string'},expectedVersion:{type:'integer',minimum:0},expectedEpoch:{type:'integer',minimum:0},manifest:{type:'object'},artifactText:{type:['string','null'],maxLength:16384},approved:{const:true,type:'boolean'}},required:['workId','writeRequestId','writer','expectedVersion','expectedEpoch','manifest','artifactText','approved'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false}}
];
