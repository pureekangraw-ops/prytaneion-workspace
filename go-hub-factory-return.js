import { createReturnPacket } from "./go-hub-centre.js";

const FACTORY_DESTINATION = "destination://factory";
function clone(value){return value==null?value:structuredClone(value);}
function freeze(value){if(value&&typeof value==="object"&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function snapshot(value){return freeze(clone(value));}
function requireFactoryAccess(access){if(!access||access.destination!==FACTORY_DESTINATION)throw new Error("Factory destination access is required");const envelope=access.envelope;if(!envelope||envelope.workId!==access.workId||envelope.checkpointId!==access.checkpointId||envelope.returnAddress!==access.returnAddress)throw new Error("Factory access envelope identity does not match Centre");return envelope;}
function returnStatus(task={}){if(task.blocker)return "WAIT";if(["CONFLICT","DEPLOY_FAILED","VERIFY_FAILED"].includes(String(task.state||"")))return "FAIL";if(task.closeout?.status==="CLOSEOUT_READY"||["CLOSED","LEARNED"].includes(String(task.factoryStage||""))||String(task.state||"")==="VERIFIED")return "PASS";return "RETURNED";}
function finalProductArtifact(task={}){return String(task.buildArtifact?.kind||"").toLowerCase()==="apk"?task.signedArtifact:task.buildArtifact;}
function exactHeadCiGreen(task={}){
  const head=String(task.headSha||"");
  const ci=task.ci||{};
  const pr=task.pullRequest||{};
  if(!head||String(task.state||"")!=="CI_GREEN")return false;
  if(String(ci.headSha||"")!==head||String(pr.headSha||"")!==head)return false;
  if(ci.status==="success"||ci.conclusion==="success")return true;
  const signals=[...(Array.isArray(ci.runs)?ci.runs:[]),...(Array.isArray(ci.checks)?ci.checks:[])];
  return signals.length>0&&signals.every(item=>item?.status==="completed"&&item?.conclusion==="success"&&(!item?.headSha||String(item.headSha)===head));
}
function pullRequestLink(task={}){
  const pr=task.pullRequest||{};
  if(pr.url||pr.html_url)return String(pr.url||pr.html_url);
  const repository=String(task.repository||"").trim();
  const number=Number(pr.number||0);
  return repository&&number>0?`https://github.com/${repository}/pull/${number}`:null;
}

export function createFactoryWorkContext(access,taskSnapshot={}){const envelope=requireFactoryAccess(access);const personaReference=envelope.personaReference??null;const target = envelope.targetId ? { targetId: envelope.targetId } : {};return snapshot({workId:access.workId,checkpointId:access.checkpointId,returnAddress:access.returnAddress,destination:access.destination,task:envelope.task,requestedResult:envelope.requestedResult,...target,personaReference,repository:String(taskSnapshot.repository||"")||null,factoryTaskId:String(taskSnapshot.id||"")||null});}

export function createFactoryRealityReturn(access,taskSnapshot={}){
  requireFactoryAccess(access);const task=clone(taskSnapshot)||{},artifact=finalProductArtifact(task);const mergeReady=exactHeadCiGreen(task);const mergeLink=mergeReady?pullRequestLink(task):null;
  return createReturnPacket(access,snapshot({
    kind:"FACTORY_REALITY_RETURN",status:returnStatus(task),targetId:access.envelope?.targetId??null,state:String(task.state||"UNKNOWN"),factoryStage:task.factoryStage==null?null:String(task.factoryStage),nextAction:mergeReady?"MERGE_READY":(task.nextAction==null?null:String(task.nextAction)),blocker:task.blocker==null?null:String(task.blocker),repository:task.repository==null?null:String(task.repository),
    mergeReady,mergeLink,
    refs:{baseBranch:task.baseBranch??null,baseSha:task.baseSha??null,workBranch:task.workBranch??null,headSha:task.headSha??null},
    pullRequest:clone(task.pullRequest)??null,ci:clone(task.ci)??null,deployment:clone(task.deployment)??null,verification:clone(task.verification)??null,
    mergeGate:clone(task.mergeGate)??null,buildArtifact:clone(task.buildArtifact)??null,signingGate:clone(task.signingGate)??null,signedArtifact:clone(task.signedArtifact)??null,signatureEvidence:clone(task.signatureEvidence)??null,
    artifact:clone(artifact)??null,publication:clone(task.publication)??null,observation:clone(task.observation)??null,closeout:clone(task.closeout)??null,lessons:Array.isArray(task.lessons)?clone(task.lessons):[],
    qc:{piece:clone(task.pieceQc)??null,assembly:clone(task.assemblyQc)??null,product:clone(task.productQc)??null,verificationScan:clone(task.verificationScan)??null},
    evidence:Array.isArray(task.evidence)?clone(task.evidence):[],
  }));
}
