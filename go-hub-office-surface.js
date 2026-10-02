const eye=document.querySelector("[data-office-eye]");
const state=document.querySelector("[data-eye-state]");
const detail=document.querySelector("[data-eye-detail]");
const message=document.querySelector("[data-eye-message]");
const refresh=document.querySelector("[data-eye-refresh]");
const clientCount=document.querySelector("[data-client-count]");
const clientMessage=document.querySelector("[data-client-message]");
const clientList=document.querySelector("[data-client-list]");
const clientRefresh=document.querySelector("[data-client-refresh]");

async function readEye(){
  if(!eye)return;
  state.textContent="CHECKING";
  eye.dataset.state="CHECKING";
  message.textContent="กำลังอ่านสถานะ Factory Eye…";
  try{
    const response=await fetch("/office/api/eye",{headers:{accept:"application/json"},cache:"no-store"});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.code||"OFFICE_EYE_UNAVAILABLE");
    const current=String(body.state||body.freshness?.state||"UNKNOWN");
    state.textContent=current;
    eye.dataset.state=current;
    detail.textContent="Factory Eye · READ ONLY";
    const title=body.latest?.tab?.title||body.latest?.page?.title||"ยังไม่มีชื่อหน้า";
    const observed=body.latest?.observedAt||body.observedAt||"UNKNOWN";
    message.textContent=title+" · "+observed;
  }catch(error){
    state.textContent="OFFLINE";
    eye.dataset.state="OFFLINE";
    detail.textContent="Factory Eye · READ ONLY";
    message.textContent=error instanceof Error?error.message:String(error);
  }
}

function clientRow(client){
  const wrap=document.createElement("div");
  wrap.className="office-client-row";
  const title=document.createElement("strong");
  title.textContent=(client.interpreted?.jobType||client.interpreted?.intent||"CLIENT")+" · "+String(client.clientId||"").slice(-8);
  const meta=document.createElement("small");
  meta.textContent=(client.interpreted?.package||"NO PACKAGE")+" · "+(client.lastSeenAt||"UNKNOWN");
  const preview=document.createElement("p");
  preview.textContent=client.latestText||"ยังไม่มีข้อความ";
  wrap.append(title,meta,preview);
  return wrap;
}

async function readClients(){
  if(!clientCount||!clientMessage||!clientList)return;
  clientMessage.textContent="กำลังอ่าน Client Registry…";
  clientList.replaceChildren();
  try{
    const response=await fetch("/office/api/clients",{headers:{accept:"application/json"},cache:"no-store"});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.code||"OFFICE_CLIENT_READ_FAILED");
    const clients=Array.isArray(body.clients)?body.clients:[];
    clientCount.textContent=String(body.count||clients.length);
    clientMessage.textContent=clients.length?"ลูกค้าล่าสุดจาก GO Client":"ยังไม่มีลูกค้าจากหน้าร้าน";
    for(const client of clients)clientList.append(clientRow(client));
  }catch(error){
    clientCount.textContent="—";
    clientMessage.textContent=error instanceof Error?error.message:String(error);
  }
}

refresh?.addEventListener("click",readEye);
clientRefresh?.addEventListener("click",readClients);
await Promise.all([readEye(),readClients()]);
