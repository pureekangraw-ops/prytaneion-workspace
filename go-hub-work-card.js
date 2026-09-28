function text(value){return String(value??"").trim();}
function unique(value=[]){
  const source=Array.isArray(value)?value:(value==null||value===""?[]:[value]);
  return [...new Set(source.map(text).filter(Boolean))];
}
function clone(value){return value==null?value:structuredClone(value);}
function freeze(value){if(value&&typeof value==="object"&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function snap(value){return freeze(clone(value));}

export const WORK_CARD_STATUS=Object.freeze({WORK:"Work",RESUME:"Resume",DONE:"Done",CANCEL:"Cancel"});
export const WORK_CARD_TYPE=Object.freeze({NORMAL:"NORMAL",URGENT:"URGENT",MAINTENANCE:"MAINTENANCE",SOS:"SOS"});
export const HEIMDALL_HEALTH=Object.freeze({NORMAL:"NORMAL",CAUTION:"CAUTION"});

const STATUS_MAP=Object.freeze({
  OPEN:WORK_CARD_STATUS.WORK,
  ARRIVED:WORK_CARD_STATUS.WORK,
  READY:WORK_CARD_STATUS.WORK,
  "ON PROCESS":WORK_CARD_STATUS.RESUME,
  WAIT:WORK_CARD_STATUS.RESUME,
  "WAIT CONFIRM":WORK_CARD_STATUS.RESUME,
  AWAY:WORK_CARD_STATUS.RESUME,
  VERIFY:WORK_CARD_STATUS.RESUME,
  COMPLETE:WORK_CARD_STATUS.DONE,
  RETURNED:WORK_CARD_STATUS.DONE,
  CANCEL:WORK_CARD_STATUS.CANCEL,
  CANCELLED:WORK_CARD_STATUS.CANCEL,
  CANCELED:WORK_CARD_STATUS.CANCEL,
});

function hash4(value){
  let hash=2166136261;
  for(const char of String(value||"")){
    hash^=char.charCodeAt(0);
    hash=Math.imul(hash,16777619)>>>0;
  }
  return hash.toString(36).toUpperCase().padStart(4,"0").slice(-4);
}
function date4(value){
  const raw=text(value);
  const direct=raw.match(/^(?:20\d{2})-(\d{2})-(\d{2})/);
  if(direct)return direct[2]+direct[1];
  const date=new Date(raw);
  if(!Number.isFinite(date.getTime()))return "0000";
  return String(date.getUTCDate()).padStart(2,"0")+String(date.getUTCMonth()+1).padStart(2,"0");
}
function workIdDate4(workId){
  const matches=[...String(workId||"").matchAll(/(20\d{2})(\d{2})(\d{2})/g)];
  const match=matches.at(-1);
  return match?match[3]+match[2]:null;
}
export function normalizeJobCode(value){
  const code=text(value).toUpperCase();
  if(!code)return null;
  if(!/^\d{4}-[A-Z0-9]{4}$/.test(code))throw new Error("Job Code is invalid");
  return code;
}
export function deriveJobCode(work={}){
  const explicit=normalizeJobCode(work.jobCode);
  if(explicit)return explicit;
  const workId=text(work.workId);
  if(!workId)throw new Error("Work ID is required");
  return (workIdDate4(workId)||date4(work.createdAt))+"-"+hash4(workId);
}
export function workCardStatus(status){
  const normalized=text(status).toUpperCase();
  return STATUS_MAP[normalized]||WORK_CARD_STATUS.WORK;
}
export function normalizeWorkType(value){
  const normalized=text(value||WORK_CARD_TYPE.NORMAL).toUpperCase();
  if(!Object.values(WORK_CARD_TYPE).includes(normalized))throw new Error("Work card type is invalid");
  return normalized;
}
export function workCardView(work={}){
  const workId=text(work.workId);
  if(!workId)throw new Error("Work ID is required");
  const destinations=unique(
    work.requestedDestinations?.length?work.requestedDestinations:
      [work.destination,work.handoff?.destination].filter(Boolean)
  );
  const scope=unique(
    work.scope?.length?work.scope:
      (work.pass?.scope?.length?work.pass.scope:[])
  );
  const status=workCardStatus(work.status);
  const jobCode=deriveJobCode(work);
  return snap({
    cardId:"CARD:"+jobCode,
    workId,
    jobCode,
    status,
    sourceStatus:text(work.status).toUpperCase()||null,
    access_scope:text(work.accessScope).toUpperCase()||null,
    tool_access:unique(work.toolAccess),
    snapshot_key:text(work.snapshotKey)||null,
    destinations,
    scope,
    type:normalizeWorkType(work.workType||work.type||WORK_CARD_TYPE.NORMAL),
    title:text(work.name||work.task||work.command)||workId,
    detail:text(work.expectedResult||work.requestedResult)||null,
    holder:text(work.holder)||null,
    createdAt:text(work.createdAt)||null,
    lastUpdated:text(work.lastUpdated)||text(work.createdAt)||null,
  });
}
export function cardCompleteness(card={}){
  const missing=[];
  if(!text(card.status))missing.push("status");
  if(!Array.isArray(card.destinations)||!card.destinations.length)missing.push("destination");
  if(!Array.isArray(card.scope)||!card.scope.length)missing.push("scope");
  if(!normalizeJobCode(card.jobCode))missing.push("jobCode");
  return freeze({complete:missing.length===0,missing:Object.freeze(missing)});
}
export function assertWorkCardComplete(card={}){
  const check=cardCompleteness(card);
  if(!check.complete)throw new Error("WORK_CARD_INCOMPLETE:"+check.missing.join(","));
  return true;
}
export function workProfile(work={}){
  const card=workCardView(work);
  return snap({
    card,
    workId:card.workId,
    checkpointId:text(work.checkpointId)||null,
    name:text(work.name||work.task||work.command)||card.title,
    command:text(work.command||work.task)||null,
    expectedResult:text(work.expectedResult||work.requestedResult)||null,
    holder:text(work.holder)||null,
    waitReason:text(work.waitReason)||null,
    attention:text(work.attention)||null,
    projectRefs:clone(work.projectRefs||{}),
    readback:clone(work.readback||work.returnedPayload||null),
  });
}
