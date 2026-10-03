const clean=v=>String(v??"").trim();
const copy=v=>v==null?v:structuredClone(v);
const SECRET_KEYS=/token|secret|password|passcode|cookie|credential|private.?key|api.?key|authorization/i;

export function sanitizeRecoveryValue(value){
  if(Array.isArray(value))return value.map(sanitizeRecoveryValue);
  if(!value||typeof value!=="object")return value;
  const out={};
  for(const [key,item] of Object.entries(value)){
    if(SECRET_KEYS.test(key))continue;
    out[key]=sanitizeRecoveryValue(item);
  }
  return out;
}

export function createPrismRecoveryService({registry,backupStore,now=()=>Date.now()}={}){
  if(!registry||typeof registry.get!=="function"||typeof registry.put!=="function")throw new TypeError("PRISM_RECOVERY_REGISTRY_REQUIRED");
  if(!backupStore||typeof backupStore.get!=="function"||typeof backupStore.put!=="function")throw new TypeError("PRISM_RECOVERY_BACKUP_STORE_REQUIRED");

  async function device(deviceId){
    return copy(await registry.get("device:"+clean(deviceId)))||null;
  }

  async function registerDevice({deviceId,label,workspaceId="PRISM",toolManifestVersion="prism-workspace-manifest-v1"}={}){
    const id=clean(deviceId);if(!id)throw new Error("PRISM_DEVICE_ID_REQUIRED");
    const current=await device(id);
    const record={
      deviceId:id,label:clean(label)||id,workspaceId,
      status:"ACTIVE",
      registeredAt:current?.registeredAt||new Date(now()).toISOString(),
      lastSeenAt:new Date(now()).toISOString(),
      toolManifestVersion,
      credentialState:"REISSUE_ON_RESTORE"
    };
    await registry.put("device:"+id,record);
    return copy(record);
  }

  async function revokeDevice(deviceId,{reason="DEVICE_LOST"}={}){
    const id=clean(deviceId);const current=await device(id);
    if(!current)throw new Error("PRISM_DEVICE_NOT_FOUND");
    const next={...current,status:"REVOKED",revokedAt:new Date(now()).toISOString(),revokeReason:clean(reason)||"DEVICE_LOST"};
    await registry.put("device:"+id,next);
    return copy(next);
  }

  async function createBackup({deviceId,workspace,evidence=[],outbox=[],toolManifest,presets={}}={}){
    const id=clean(deviceId);const current=await device(id);
    if(!current||current.status!=="ACTIVE")throw new Error("PRISM_DEVICE_ACTIVE_REQUIRED");
    const backupId="PRISM-BACKUP-"+now();
    const payload=sanitizeRecoveryValue({
      schemaVersion:"prism-workspace-backup-v1",
      backupId,workspaceId:current.workspaceId,sourceDeviceId:id,
      createdAt:new Date(now()).toISOString(),
      workspace:workspace||{},
      evidenceIndex:Array.isArray(evidence)?evidence.map(item=>({kind:item?.kind||null,ref:item?.ref||item?.pageFingerprint||null,capturedAt:item?.capturedAt||null})):[],
      outboxMetadata:Array.isArray(outbox)?outbox.map(item=>({id:item?.id||null,capability:item?.capability||null,state:item?.state||null,queuedAt:item?.queuedAt||null})):[],
      toolManifest:toolManifest||null,
      presets:presets||{},
      restorePolicy:{secrets:"REISSUE",authority:"CENTRAL_RECHECK",tools:"REINSTALL_OR_RECONNECT"}
    });
    await backupStore.put(backupId,payload);
    await registry.put("latest:"+current.workspaceId,{backupId,createdAt:payload.createdAt,sourceDeviceId:id});
    return copy(payload);
  }

  async function latestBackup(workspaceId="PRISM"){
    const pointer=await registry.get("latest:"+clean(workspaceId));
    if(!pointer?.backupId)return null;
    return copy(await backupStore.get(pointer.backupId))||null;
  }

  async function restorePlan({workspaceId="PRISM",targetDeviceId}={}){
    const target=await device(targetDeviceId);
    if(!target||target.status!=="ACTIVE")throw new Error("PRISM_TARGET_DEVICE_ACTIVE_REQUIRED");
    const backup=await latestBackup(workspaceId);
    if(!backup)throw new Error("PRISM_BACKUP_NOT_FOUND");
    return Object.freeze({
      workspaceId,backupId:backup.backupId,targetDeviceId:target.deviceId,
      restore:{
        workspace:copy(backup.workspace),
        evidenceIndex:copy(backup.evidenceIndex),
        outboxMetadata:copy(backup.outboxMetadata),
        toolManifest:copy(backup.toolManifest),
        presets:copy(backup.presets)
      },
      actions:[
        "REINSTALL_LOCAL_TOOLS",
        "RESTORE_CONFIG_AND_PRESETS",
        "RESTORE_WORK_REFS_AND_EVIDENCE_INDEX",
        "REPAIR_REMOTE_CONNECTORS",
        "REISSUE_CREDENTIALS",
        "RECHECK_GOVERNED_AUTHORITY"
      ],
      secretsRestored:false,
      authorityRestored:false
    });
  }

  return Object.freeze({device,registerDevice,revokeDevice,createBackup,latestBackup,restorePlan});
}

export const PRISM_RECOVERY_CONTRACT=Object.freeze({
  version:"prism-recovery-v1",
  invariant:"A lost device may lose disposable local cache, but not workspace identity, tool manifest, recoverable config, work refs, or evidence index.",
  secrets:"Never back up raw credentials; revoke and reissue.",
  authority:"Never restore authority from device backup; re-check central truth."
});
