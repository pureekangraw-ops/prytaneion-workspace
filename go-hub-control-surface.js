import { createCentreLiveClient } from "./go-hub-centre-client.js";

const q=s=>document.querySelector(s);
const put=(s,v)=>{const n=q(s);if(n)n.textContent=v==null||v===""?"UNKNOWN":String(v)};
const centreLive=createCentreLiveClient({fetchImpl:globalThis.fetch.bind(globalThis),storage:globalThis.localStorage});
const POINTER_KEY="go-hub-centre-live-pointer-v1";let work=null;function pointer(){try{const p=JSON.parse(localStorage.getItem(POINTER_KEY)||"null");return p?.workId&&p?.checkpointId?p:null}catch{return null}}function save(w){if(w?.workId&&w?.checkpointId)localStorage.setItem(POINTER_KEY,JSON.stringify({workId:w.workId,checkpointId:w.checkpointId}))}

function renderWork(w={}) {
  work=w;
  put("[data-control-room-work]",w.workId);
  put("[data-control-room-checkpoint]",w.checkpointId);
  put("[data-control-room-centre]",w.status);
  put("[data-control-room-status]",w.status||"UNKNOWN");
  put("[data-work-title]",w.task||"งานปัจจุบัน");
  const holder=w.holder||"GO";
  put("[data-holder]",holder);
  put("[data-work-now]",holder+" กำลังถือ Work นี้");
  const s=String(w.status||"").toUpperCase();
  put("[data-count-active]",["ACTIVE","ON PROCESS","DOING","PROCESSING","ARRIVED","REVIEWED"].includes(s)?1:0);
  put("[data-count-complete]",["COMPLETE","COMPLETED","VERIFIED"].includes(s)?1:0);
  put("[data-count-decision]",["BLOCKED","UNKNOWN","WAIT VERIFY","WAIT_VERIFY"].includes(s)?1:0);
}
async function refreshWork(){
  try{
    work=work?.workId?await centreLive.inspect(work.workId,work.checkpointId):await centreLive.restoreOrStart();
    renderWork(work);
    q("[data-control-room-error]").textContent="";
  }catch(e){
    put("[data-control-room-status]","UNKNOWN");
    q("[data-control-room-error]").textContent=e instanceof Error?e.message:String(e);
  }
}
async function refreshReality(){
  if(!work?.workId)return refreshWork();
  try{
    const p=new URLSearchParams({workId:work.workId,checkpointId:work.checkpointId||""});
    const r=await fetch("/hub/api/centre/control-room?"+p);
    const b=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(b.code||"CONTROL_ROOM_READ_FAILED");
    const o=b.observations||{};
    put("[data-control-room-status]",o.overall||b.overall||work.status);
    put("[data-control-room-project]",o.sourceStatus?.project);
    put("[data-control-room-factory]",o.sourceStatus?.factory);
    put("[data-control-room-board]",o.board?.status);
    put("[data-control-room-cloudflare]",o.sourceStatus?.cloudflare);
    put("[data-control-room-provenance]",o.deploymentProvenance?.status);
    put("[data-control-room-updated]",b.observedAt||b.checkedAt||"UNKNOWN");
    q("[data-control-room-error]").textContent="";
  }catch(e){
    await refreshWork();
    q("[data-control-room-error]").textContent="Reality detail: "+(e instanceof Error?e.message:String(e));
  }
}
q("[data-control-room-refresh]")?.addEventListener("click",refreshReality);
q("[data-details-toggle]")?.addEventListener("click",()=>{
  const d=q("[data-technical]");d.hidden=!d.hidden;
  q("[data-details-toggle]").textContent=d.hidden?"ดูรายละเอียด":"ซ่อนรายละเอียด";
});
const dialog=q("[data-command-dialog]");
q("[data-command-open]")?.addEventListener("click",()=>dialog?.showModal());
q("[data-command-submit]")?.addEventListener("click",async()=>{
  const task=q("[data-command-task]").value.trim();
  const requestedResult=q("[data-command-result]").value.trim()||task;
  const error=q("[data-command-error]");
  if(!task){error.textContent="พิมพ์งานก่อน";return}
  error.textContent="";
  try{
    const fresh=await centreLive.startNew();
    const created=await centreLive.command({
      action:"review",workId:fresh.workId,checkpointId:fresh.checkpointId,
      returnAddress:fresh.checkpointId,task,requestedResult,authority:"BIG",targetId:"standard"
    });
    renderWork(created);
    q("[data-command-task]").value="";
    q("[data-command-result]").value="";
    dialog.close();
    await refreshReality();
  }catch(e){error.textContent=e instanceof Error?e.message:String(e)}
});
await refreshWork();
await refreshReality();
setInterval(refreshReality,30000);
