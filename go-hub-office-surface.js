function b64urlToBytes(value){
  const s=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
  const p=s+"=".repeat((4-s.length%4)%4);
  const bin=atob(p);return Uint8Array.from(bin,c=>c.charCodeAt(0));
}
function bytesToB64url(value){
  const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
  let s="";for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}

const eye=document.querySelector("[data-office-eye]");
const state=document.querySelector("[data-eye-state]");
const detail=document.querySelector("[data-eye-detail]");
const message=document.querySelector("[data-eye-message]");
const refresh=document.querySelector("[data-eye-refresh]");
const observeNow=document.querySelector("[data-eye-observe]");
const passkeyButton=document.querySelector("[data-passkey-register]");
const passkeyStatus=document.querySelector("[data-passkey-status]");
const assetForm=document.querySelector("[data-asset-upload]");
const assetStatus=document.querySelector("[data-asset-status]");
const assetList=document.querySelector("[data-asset-list]");

const workList=document.querySelector("[data-work-list]");
const workForm=document.querySelector("[data-work-form]");
const workMessage=document.querySelector("[data-work-message]");
const workRefresh=document.querySelector("[data-work-refresh]");
const workActive=document.querySelector("[data-work-active]");
const workWaiting=document.querySelector("[data-work-waiting]");
const workDone=document.querySelector("[data-work-done]");
const workEye=document.querySelector("[data-work-eye]");
const spectrumCreate=document.querySelector("[data-spectrum-create]");
const spectrumPickup=document.querySelector("[data-spectrum-pickup]");
const spectrumStatus=document.querySelector("[data-spectrum-status]");
const OFFICE_TRACKED_WORK_KEY="ygg-office-tracked-work-v1";
const OFFICE_WORK_CACHE_KEY="ygg-office-work-cache-v1";
const OFFICE_EYE_CACHE_KEY="ygg-office-eye-cache-v1";

function loadLocalJson(key,fallback){
  try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));}
  catch{return fallback;}
}
function workCacheKey(identity){return identity.workId+"::"+identity.checkpointId;}
function loadCachedWork(identity){
  const cache=loadLocalJson(OFFICE_WORK_CACHE_KEY,{});
  return cache&&typeof cache==="object"?cache[workCacheKey(identity)]||null:null;
}
function saveCachedWork(identity,work){
  const cache=loadLocalJson(OFFICE_WORK_CACHE_KEY,{});
  const next=cache&&typeof cache==="object"?cache:{};
  next[workCacheKey(identity)]={work,syncedAt:new Date().toISOString()};
  const entries=Object.entries(next).sort((a,b)=>String(b[1]?.syncedAt||"").localeCompare(String(a[1]?.syncedAt||""))).slice(0,24);
  localStorage.setItem(OFFICE_WORK_CACHE_KEY,JSON.stringify(Object.fromEntries(entries)));
}
function loadCachedEye(){return loadLocalJson(OFFICE_EYE_CACHE_KEY,null);}
function saveCachedEye(body){
  const latest=body?.latest||{};
  localStorage.setItem(OFFICE_EYE_CACHE_KEY,JSON.stringify({
    source:"FACTORY_EYE",
    state:String(body?.state||body?.freshness?.state||"UNKNOWN"),
    title:String(latest?.tab?.title||latest?.page?.title||""),
    observedAt:String(latest?.observedAt||body?.observedAt||""),
    syncedAt:new Date().toISOString(),
    createsAuthority:false
  }));
}

function loadTrackedWork(){
  try{
    const parsed=JSON.parse(localStorage.getItem(OFFICE_TRACKED_WORK_KEY)||"[]");
    return Array.isArray(parsed)?parsed.filter(item=>item&&item.workId&&item.checkpointId).slice(0,24):[];
  }catch{return[];}
}
function saveTrackedWork(items){
  localStorage.setItem(OFFICE_TRACKED_WORK_KEY,JSON.stringify(items.slice(0,24)));
}
function normalizedStatus(value){
  return String(value||"UNKNOWN").trim().toUpperCase().replace(/\s+/g," ");
}
function statusBucket(status){
  if(["ON PROCESS","ON_PROCESS","DOING","ACTIVE","OPEN"].includes(status))return"active";
  if(["WAIT","WAITING","WAIT VERIFY","WAIT_VERIFY","VERIFY","REVIEW_REQUIRED"].includes(status))return"waiting";
  if(["COMPLETE","COMPLETED","DONE"].includes(status))return"done";
  if(["CANCEL","CANCELLED","FAILED","BLOCKED"].includes(status))return"attention";
  return"unknown";
}
function displayTime(value){
  const ms=Date.parse(String(value||""));
  if(!Number.isFinite(ms))return"ไม่ทราบเวลา";
  return new Intl.DateTimeFormat("th-TH",{dateStyle:"short",timeStyle:"short"}).format(new Date(ms));
}
function textValue(...values){
  for(const value of values){
    const text=String(value??"").trim();
    if(text)return text;
  }
  return"—";
}
async function readWork(identity){
  const query=new URLSearchParams({workId:identity.workId,checkpointId:identity.checkpointId});
  const response=await fetch("/office/api/work?"+query.toString(),{headers:{accept:"application/json"},cache:"no-store"});
  const body=await response.json().catch(()=>({}));
  if(response.status===401){
    location.assign("/office/login");
    throw new Error("OFFICE_AUTH_REQUIRED");
  }
  if(!response.ok)throw new Error(body.code||"OFFICE_WORK_READ_FAILED");
  return body.work||body;
}
function makeWorkCard(work,identity,{source="LIVE",syncedAt=null}={}){
  const card=document.createElement("article");
  card.className="office-work-card";
  const status=normalizedStatus(work.status);
  card.dataset.status=statusBucket(status);

  const top=document.createElement("div");
  top.className="office-work-card-top";
  const badge=document.createElement("strong");
  badge.className="office-work-status";
  badge.textContent=status;
  const remove=document.createElement("button");
  remove.type="button";
  remove.className="office-work-remove";
  remove.textContent="Untrack";
  remove.addEventListener("click",()=>{
    const next=loadTrackedWork().filter(item=>!(item.workId===identity.workId&&item.checkpointId===identity.checkpointId));
    saveTrackedWork(next);
    readTrackedWork();
  });
  top.append(badge,remove);

  const title=document.createElement("h4");
  title.textContent=textValue(work.name,work.command,work.jobCode,identity.workId);
  const ids=document.createElement("code");
  ids.textContent=identity.workId+" · "+identity.checkpointId;

  const meta=document.createElement("div");
  meta.className="office-work-meta";
  const holder=document.createElement("span");
  holder.textContent="Holder: "+textValue(work.holder,work.ownerId);
  const updated=document.createElement("span");
  updated.textContent="Updated: "+displayTime(work.lastUpdated||work.updatedAt);
  const destination=document.createElement("span");
  destination.textContent="Next: "+textValue(work.nextAction,work.destination,(work.requestedDestinations||[]).join(", "));
  const sourceLine=document.createElement("span");
  sourceLine.textContent=source==="CACHE"
    ?"Source: CACHED · synced "+displayTime(syncedAt)
    :"Source: LIVE";
  meta.append(holder,updated,destination,sourceLine);

  const note=document.createElement("p");
  note.textContent=textValue(work.waitReason,work.result,work.requestedResult,work.initialContext?.summary,"Centre owner truth");
  card.append(top,title,ids,meta,note);
  return card;
}
async function readTrackedWork(){
  if(!workList)return;
  const tracked=loadTrackedWork();
  workList.replaceChildren();
  if(!tracked.length){
    workMessage.textContent="ยังไม่ได้ปักงาน · ใส่ Work ID และ Checkpoint ID ด้านบน";
    if(workActive)workActive.textContent="0";
    if(workWaiting)workWaiting.textContent="0";
    if(workDone)workDone.textContent="0";
    return;
  }
  workMessage.textContent="กำลังอ่าน Centre owner truth…";
  const counters={active:0,waiting:0,done:0,attention:0,unknown:0};
  let ok=0;
  let cachedCount=0;
  for(const identity of tracked){
    try{
      const work=await readWork(identity);
      saveCachedWork(identity,work);
      const bucket=statusBucket(normalizedStatus(work.status));
      counters[bucket]=(counters[bucket]||0)+1;
      workList.append(makeWorkCard(work,identity,{source:"LIVE"}));
      ok+=1;
    }catch(error){
      const cached=loadCachedWork(identity);
      if(cached?.work){
        const bucket=statusBucket(normalizedStatus(cached.work.status));
        counters[bucket]=(counters[bucket]||0)+1;
        workList.append(makeWorkCard(cached.work,identity,{source:"CACHE",syncedAt:cached.syncedAt}));
        cachedCount+=1;
        continue;
      }
      const card=document.createElement("article");
      card.className="office-work-card";
      card.dataset.status="attention";
      const title=document.createElement("h4");
      title.textContent=identity.workId;
      const detail=document.createElement("p");
      detail.textContent="UNAVAILABLE · "+(error instanceof Error?error.message:String(error));
      card.append(title,detail);
      workList.append(card);
      counters.attention+=1;
    }
  }
  if(workActive)workActive.textContent=String(counters.active||0);
  if(workWaiting)workWaiting.textContent=String(counters.waiting||0);
  if(workDone)workDone.textContent=String(counters.done||0);
  workMessage.textContent=cachedCount
    ?"DEGRADED MODE · live "+ok+" · cached "+cachedCount+" · "+new Date().toLocaleTimeString("th-TH")
    :"LIVE · อ่านกลับ "+ok+"/"+tracked.length+" งาน · "+new Date().toLocaleTimeString("th-TH");
}
function trackWork(event){
  event.preventDefault();
  const data=new FormData(workForm);
  const workId=String(data.get("workId")||"").trim();
  const checkpointId=String(data.get("checkpointId")||"").trim();
  if(!workId||!checkpointId)return;
  const items=loadTrackedWork();
  if(!items.some(item=>item.workId===workId&&item.checkpointId===checkpointId)){
    items.unshift({workId,checkpointId});
    saveTrackedWork(items);
  }
  workForm.reset();
  readTrackedWork();
}
async function spectrumCommand(payload){
  const response=await fetch("/office/api/command",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify(payload)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.code||"SPECTRUM_COMMAND_FAILED");
  const ctx=body.workContext;
  if(ctx?.workId&&ctx?.checkpointId){
    const items=loadTrackedWork();
    if(!items.some(item=>item.workId===ctx.workId&&item.checkpointId===ctx.checkpointId)){
      items.unshift({workId:ctx.workId,checkpointId:ctx.checkpointId});
      saveTrackedWork(items);
    }
  }
  return body;
}
async function createSpectrumTablet(event){
  event.preventDefault();
  const data=new FormData(spectrumCreate);
  const mission=String(data.get("mission")||"").trim();
  const requestedResult=String(data.get("requestedResult")||"").trim();
  const workKey=String(data.get("workKey")||"").trim();
  if(!mission||!requestedResult)return;
  spectrumStatus.textContent="SPECTRUM กำลังเตรียม Work Tablet…";
  try{
    const body=await spectrumCommand({action:"create_tablet",agentId:"GO",mission,requestedResult,workKey:workKey||("OFFICE-"+Date.now()),workType:"NORMAL",initialContext:{source:"SPECTRUM_WORK",surface:"OFFICE"}});
    spectrumStatus.textContent=(body.tabletId||"Work Tablet")+" พร้อม · backend policy คุม authority";
    spectrumCreate.reset();
    await readTrackedWork();
  }catch(error){spectrumStatus.textContent="NOT EXECUTED · "+(error instanceof Error?error.message:String(error));}
}
async function pickupSpectrumTablet(event){
  event.preventDefault();
  const data=new FormData(spectrumPickup);
  const tabletId=String(data.get("tabletId")||"").trim();
  if(!tabletId)return;
  spectrumStatus.textContent="SPECTRUM กำลังหยิบ Tablet…";
  try{
    const body=await spectrumCommand({action:"pickup_tablet",tabletId,agentId:"GO"});
    spectrumStatus.textContent=(body.tabletId||tabletId)+" พร้อมทำต่อ";
    spectrumPickup.reset();
    await readTrackedWork();
  }catch(error){spectrumStatus.textContent="NOT EXECUTED · "+(error instanceof Error?error.message:String(error));}
}

function adoptWorkFromUrl(){
  const query=new URLSearchParams(location.search);
  const workId=String(query.get("workId")||"").trim();
  const checkpointId=String(query.get("checkpointId")||"").trim();
  if(!workId||!checkpointId)return;
  const items=loadTrackedWork();
  if(!items.some(item=>item.workId===workId&&item.checkpointId===checkpointId)){
    items.unshift({workId,checkpointId});
    saveTrackedWork(items);
  }
}

async function readEye(){
  if(!eye)return;
  state.textContent="CHECKING";
  eye.dataset.state="CHECKING";
  message.textContent="กำลังอ่านสถานะ Factory Eye…";
  try{
    const response=await fetch("/office/api/eye",{headers:{accept:"application/json"},cache:"no-store"});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.code||"OFFICE_EYE_UNAVAILABLE");
    saveCachedEye(body);
    const current=String(body.state||body.freshness?.state||"UNKNOWN");
    state.textContent=current;
    eye.dataset.state=current;
    if(workEye)workEye.textContent=current;
    detail.textContent="Factory Eye · READ ONLY";
    const title=body.latest?.tab?.title||body.latest?.page?.title||"ยังไม่มีชื่อหน้า";
    const observed=body.latest?.observedAt||body.observedAt||"UNKNOWN";
    message.textContent=title+" · "+observed;
  }catch(error){
    const cached=loadCachedEye();
    if(cached){
      state.textContent="STALE";
      eye.dataset.state="STALE";
      if(workEye)workEye.textContent="STALE";
      detail.textContent="Factory Eye · CACHED READ ONLY";
      message.textContent=(cached.title||"Factory Eye cached")+" · observed "+displayTime(cached.observedAt||cached.syncedAt)+" · DEGRADED";
      return;
    }
    state.textContent="OFFLINE";
    eye.dataset.state="OFFLINE";
    if(workEye)workEye.textContent="OFFLINE";
    detail.textContent="Factory Eye · READ ONLY";
    message.textContent=error instanceof Error?error.message:String(error);
  }
}

async function requestEyeObservation(){
  if(!observeNow)return;
  observeNow.disabled=true;
  state.textContent="WAKING";
  eye.dataset.state="WAKING";
  message.textContent="กำลังขอ Factory Eye เก็บภาพปัจจุบัน…";
  try{
    const response=await fetch("/office/api/eye/refresh",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:"{}"});
    const body=await response.json().catch(()=>({}));
    if(response.status===401){location.assign("/office/login");throw new Error("OFFICE_AUTH_REQUIRED");}
    if(!response.ok)throw new Error(body.code||"OFFICE_EYE_OBSERVE_FAILED");
    message.textContent="ส่ง OBSERVE_NOW แล้ว · รอ Factory Eye…";
    await new Promise(resolve=>setTimeout(resolve,3500));
    await readEye();
  }catch(error){
    message.textContent=error instanceof Error?error.message:String(error);
  }finally{
    observeNow.disabled=false;
  }
}

async function readPasskeyStatus(){
  if(!passkeyStatus)return;
  if(!window.PublicKeyCredential||!navigator.credentials){
    passkeyStatus.textContent="อุปกรณ์นี้ยังไม่รองรับ Passkey";
    if(passkeyButton)passkeyButton.disabled=true;
    return;
  }
  try{
    const response=await fetch("/office/passkey/status",{cache:"no-store"});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.code||"PASSKEY_STATUS_FAILED");
    passkeyStatus.textContent=body.registered?"Passkey พร้อมใช้งานแล้ว":"ยังไม่มี Passkey · สร้างบนอุปกรณ์นี้ได้เลย";
    if(passkeyButton)passkeyButton.textContent=body.registered?"Replace Passkey":"Create Passkey";
  }catch(error){
    passkeyStatus.textContent=error instanceof Error?error.message:String(error);
  }
}

async function registerPasskey(){
  if(!passkeyButton||!passkeyStatus)return;
  passkeyButton.disabled=true;
  passkeyStatus.textContent="กำลังสร้าง Passkey…";
  try{
    const optionsResponse=await fetch("/office/passkey/register/options",{method:"POST",headers:{"content-type":"application/json"}});
    const optionsBody=await optionsResponse.json().catch(()=>({}));
    if(!optionsResponse.ok)throw new Error(optionsBody.code||"PASSKEY_OPTIONS_FAILED");
    const publicKey={...optionsBody.publicKey,challenge:b64urlToBytes(optionsBody.publicKey.challenge),user:{...optionsBody.publicKey.user,id:b64urlToBytes(optionsBody.publicKey.user.id)}};
    const credential=await navigator.credentials.create({publicKey});
    if(!credential)throw new Error("PASSKEY_CANCELLED");
    const response=credential.response;
    if(typeof response.getPublicKey!=="function"||typeof response.getAuthenticatorData!=="function"){
      throw new Error("PASSKEY_BROWSER_TOO_OLD");
    }
    const publicKeySpki=response.getPublicKey();
    const authenticatorData=response.getAuthenticatorData();
    const algorithm=typeof response.getPublicKeyAlgorithm==="function"?response.getPublicKeyAlgorithm():-7;
    const transports=typeof response.getTransports==="function"?response.getTransports():[];
    if(!publicKeySpki||!authenticatorData)throw new Error("PASSKEY_REGISTRATION_DATA_MISSING");
    const verifyResponse=await fetch("/office/passkey/register/verify",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        credentialId:credential.id,
        clientDataJSON:bytesToB64url(response.clientDataJSON),
        publicKeySpki:bytesToB64url(publicKeySpki),
        authenticatorData:bytesToB64url(authenticatorData),
        algorithm,
        transports
      })
    });
    const verifyBody=await verifyResponse.json().catch(()=>({}));
    if(!verifyResponse.ok||verifyBody.ok!==true)throw new Error(verifyBody.code||"PASSKEY_VERIFY_FAILED");
    passkeyStatus.textContent="สร้าง Passkey สำเร็จ · ครั้งหน้ากด Use Passkey ได้เลย";
    passkeyButton.textContent="Replace Passkey";
  }catch(error){
    passkeyStatus.textContent=error instanceof Error?error.message:String(error);
  }finally{
    passkeyButton.disabled=false;
  }
}

async function readAssets(){
  if(!assetList)return;
  assetList.innerHTML="";
  try{
    const response=await fetch("/office/api/assets",{headers:{accept:"application/json"},cache:"no-store"});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.code||"OFFICE_ASSET_LIST_FAILED");
    const assets=Array.isArray(body.assets)?body.assets:[];
    if(!assets.length){
      assetList.innerHTML="<li>ยังไม่มีไฟล์</li>";
      return;
    }
    for(const asset of assets){
      const item=document.createElement("li");
      const link=document.createElement("a");
      link.href="/office/api/assets?raw=1&key="+encodeURIComponent(asset.key||"");
      link.target="_blank";
      link.rel="noreferrer";
      link.textContent=asset.customMetadata?.originalName||asset.key||"asset";
      const meta=document.createElement("small");
      meta.textContent=" · "+Math.max(1,Math.round(Number(asset.size||0)/1024))+" KB · "+(asset.customMetadata?.category||"uploads");
      item.append(link,meta);
      assetList.append(item);
    }
  }catch(error){
    assetList.innerHTML="<li>"+String(error instanceof Error?error.message:error)+"</li>";
  }
}

async function uploadAsset(event){
  event.preventDefault();
  if(!assetForm||!assetStatus)return;
  const data=new FormData(assetForm);
  const file=data.get("file");
  if(!file||!file.size){
    assetStatus.textContent="เลือกไฟล์ก่อน";
    return;
  }
  assetStatus.textContent="กำลังอัปโหลด…";
  const button=assetForm.querySelector("button[type=submit]");
  if(button)button.disabled=true;
  try{
    const response=await fetch("/office/api/assets",{method:"POST",body:data});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.code||"OFFICE_ASSET_UPLOAD_FAILED");
    const name=body.asset?.customMetadata?.originalName||"ไฟล์";
    assetStatus.textContent=name+" อัปโหลดและอ่านกลับสำเร็จ";
    assetForm.reset();
    await readAssets();
  }catch(error){
    assetStatus.textContent=error instanceof Error?error.message:String(error);
  }finally{
    if(button)button.disabled=false;
  }
}

assetForm?.addEventListener("submit",uploadAsset);
refresh?.addEventListener("click",readEye);
observeNow?.addEventListener("click",requestEyeObservation);
passkeyButton?.addEventListener("click",registerPasskey);
workForm?.addEventListener("submit",trackWork);
spectrumCreate?.addEventListener("submit",createSpectrumTablet);
spectrumPickup?.addEventListener("submit",pickupSpectrumTablet);
workRefresh?.addEventListener("click",readTrackedWork);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")readTrackedWork();});
adoptWorkFromUrl();
setInterval(()=>{if(document.visibilityState==="visible")readTrackedWork();},30000);
await Promise.all([readEye(),readPasskeyStatus(),readAssets(),readTrackedWork()]);
