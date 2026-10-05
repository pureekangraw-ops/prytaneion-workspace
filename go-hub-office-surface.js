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
  return new Intl.DateTimeFormat("th-TH",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Bangkok"}).format(new Date(ms));
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

const overviewWorks=document.querySelector('[data-overview-works]');
const overviewResults=document.querySelector('[data-overview-results]');
const overviewCoverage=document.querySelector('[data-overview-coverage]');
const overviewMore=document.querySelector('[data-overview-more]');
const overviewSales=document.querySelector('[data-overview-sales]');
const overviewQuotes=document.querySelector('[data-overview-quotes]');
const quoteForm=document.querySelector('[data-quote-form]');
const quoteStatus=document.querySelector('[data-quote-status]');
const overviewActivity=document.querySelector('[data-overview-activity]');
const overviewActivityStatus=document.querySelector('[data-overview-activity-status]');
const overviewHealth=document.querySelector('[data-overview-health]');
const overviewMismatches=document.querySelector('[data-overview-mismatches]');
const dailySummary=document.querySelector('[data-daily-summary]');
const summaryStatus=document.querySelector('[data-summary-status]');
const salesMore=document.querySelector('[data-sales-more]');
const officePage=document.body.dataset.officePage||'home';
const workView=document.querySelector('[data-work-view]')?.dataset.workView||'current';
const workLabels={'OPEN':'รอเริ่มงาน','ON PROCESS':'กำลังทำ','WAIT CONFIRM':'รอบิ๊กดู','COMPLETE':'เสร็จแล้ว','CANCEL':'ยกเลิกแล้ว','CANCELLED':'ยกเลิกแล้ว','UNKNOWN':'ยังอ่านสถานะไม่ได้'};
const briefLabels={goal:'โจทย์',jobType:'ประเภทงาน',audience:'ทำให้ใครดู',materials:'ข้อมูลที่มี',pageCount:'จำนวนหน้า',package:'แพ็กเกจ',desiredDate:'วันที่ต้องการ',deadlineText:'กำหนดส่ง'};
let overviewOffset=null,salesCursor=null,loadedWorks=new Map(),loadedSales=new Map(),overviewBusy=false;
function overviewText(parent,tag,value,className){const node=document.createElement(tag);node.textContent=String(value||'—');if(className)node.className=className;parent.append(node);return node;}
function overviewCard(parent,title,status,lines){const card=document.createElement('article');card.className='office-work-card';overviewText(card,'strong',workLabels[status]||status,'office-work-status');overviewText(card,'h4',title);for(const line of lines.filter(Boolean))overviewText(card,'p',line,'office-muted');parent.append(card);return card;}
function appendWorkFlow(card,status){
 const s=normalizedStatus(status),steps=['รับงาน','กำลังทำ','รอตรวจ','เสร็จ'];
 let current=s==='COMPLETE'||s==='DONE'?3:s.includes('WAIT')||s.includes('VERIFY')?2:['ON PROCESS','ON_PROCESS','DOING','ACTIVE'].includes(s)?1:0;
 const flow=document.createElement('div');flow.className='office-flow';flow.setAttribute('aria-label','เส้นทางงาน');
 steps.forEach((label,index)=>{const step=document.createElement('span');step.textContent=label;step.className=index<current?'is-done':index===current?'is-current':'';flow.append(step);});
 card.append(flow);
}
function workDetails(card,w){const details=document.createElement('details');overviewText(details,'summary','ดูรายละเอียด');overviewText(details,'code',w.workId);overviewText(details,'small','ตรวจล่าสุด '+displayTime(w.checkedAt));if(w.lastUpdated)overviewText(details,'p','อัปเดตงาน '+displayTime(w.lastUpdated));card.append(details);return details;}
function evidenceLinks(card,w){
 for(const evidence of w.readback?.evidence||[]){const ref=String(evidence.ref||evidence.evidenceRef||'');try{const url=new URL(ref);if(url.protocol!=='https:'||url.username||url.password)throw Error();const link=overviewText(card,'a',evidence.label||'เปิดผลลัพธ์ / หลักฐาน ↗','office-result-link');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';}catch{overviewText(card,'code',ref);}}
}
async function overviewRead(route){const response=await fetch('/office/api/'+route,{cache:'no-store'});if(!response.ok)throw Error('UNKNOWN');return response.json();}
function renderOverviewWorks(){
 overviewWorks?.replaceChildren();overviewResults?.replaceChildren();
 const items=[...loadedWorks.values()];
 for(const w of officePage==='home'?items.slice(0,6):items){
  if(overviewWorks){const card=overviewCard(overviewWorks,w.name||'งานที่ยังไม่มีชื่อ',w.status,[w.waitReason||'',w.holder?'ผู้ดูแลงาน: '+String(w.holder):'']);appendWorkFlow(card,w.status);const details=workDetails(card,w);if(w.readback?.result){const result=w.readback.result;overviewText(details,'p',typeof result==='string'?result:result.summary||result.reason||'มีผลกลับจากงาน');}evidenceLinks(details,w);}
  if(overviewResults){const result=w.readback?.result??w.result;const summary=typeof result==='string'?result:result?.summary||result?.reason||'ยังไม่มีสรุปผลที่แสดงได้';const card=overviewCard(overviewResults,w.name||'ผลงาน',w.status,[summary]);evidenceLinks(card,w);workDetails(card,w);}
 }
 if(overviewWorks&&!overviewWorks.children.length)overviewText(overviewWorks,'p',officePage==='history'?'ยังไม่มีประวัติในรายการนี้':'ตอนนี้ไม่มีงานที่รอบิ๊กดูหรือกำลังทำ');
 if(overviewResults&&!overviewResults.children.length)overviewText(overviewResults,'p','ยังไม่มีผลงานที่เสร็จแล้วในรายการนี้');
}
async function loadOverviewWorks(append=false){
 if(!overviewWorks&&!overviewResults)return;
 try{const data=await overviewRead('works?view='+workView+'&offset='+(append?overviewOffset||0:0));if(!append)loadedWorks.clear();for(const w of data.works)loadedWorks.set(w.workId,w);overviewOffset=data.nextOffset;if(overviewMore)overviewMore.hidden=overviewOffset===null||officePage==='home';renderOverviewWorks();
 const counts={};for(const w of loadedWorks.values())counts[w.status]=(counts[w.status]||0)+1;
 overviewCoverage.textContent=officePage==='home'?'แสดง '+Math.min(6,loadedWorks.size)+' จาก '+data.total+' งานปัจจุบัน':'แสดง '+loadedWorks.size+' จาก '+data.total+' รายการ · อัปเดต '+displayTime(data.checkedAt);
 }catch{overviewCoverage.textContent='ตอนนี้อ่านงานล่าสุดไม่ได้'+(loadedWorks.size?' · ด้านล่างเป็นข้อมูลครั้งก่อน':' · ลองกดอัปเดตอีกครั้ง');}
}
function renderOverviewActivity(data){
 if(!overviewActivity)return;
 overviewActivity.replaceChildren();
  for(const item of data.items||[]){
   const card=overviewCard(overviewActivity,item.name||item.workId,item.status,[item.movement||'',item.movedAt?'ขยับล่าสุด '+displayTime(item.movedAt):'']);
   appendWorkFlow(card,item.status);
  }
  if(!(data.items||[]).length)overviewText(overviewActivity,'p','ตอนนี้ยังไม่มีการเคลื่อนไหวของงาน');
  if(overviewActivityStatus)overviewActivityStatus.textContent='อ่านจาก Centre Work truth · อัปเดต '+displayTime(data.checkedAt);
}
async function loadOverviewActivity(){
 if(!overviewActivity)return;
 try{
  renderOverviewActivity(await overviewRead('activity?limit=12'));
 }catch{overviewActivity.replaceChildren();overviewText(overviewActivity,'p','ตอนนี้อ่านการเคลื่อนไหวไม่ได้');if(overviewActivityStatus)overviewActivityStatus.textContent='สถานะ UNKNOWN';}
}
async function loadOverviewHealth(){
 if(!overviewHealth&&!overviewMismatches)return;
 try{
  const data=await overviewRead('health');
  overviewHealth?.replaceChildren();overviewMismatches?.replaceChildren();
  if(overviewHealth){
   const state=data.state==='STABLE'?'เสถียรตามสิ่งที่ตรวจได้':'มีจุดที่ควรดู';
   overviewCard(overviewHealth,'ภาพรวม',state,[`งานปัจจุบัน ${data.counts.current} · รอ ${data.counts.waiting} · UNKNOWN ${data.counts.unknown} · mismatch ${data.counts.mismatches}`, 'ตรวจ '+displayTime(data.checkedAt)]);
  }
  if(overviewMismatches){
   for(const m of data.mismatches||[])overviewCard(overviewMismatches,m.workId,'MISMATCH',[m.message,m.kind]);
   if(!(data.mismatches||[]).length)overviewText(overviewMismatches,'p','ยังไม่พบ state / owner mismatch ในชุดงานที่ตรวจ','office-muted');
  }
 }catch{overviewHealth?.replaceChildren();overviewMismatches?.replaceChildren();if(overviewHealth)overviewText(overviewHealth,'p','ตอนนี้อ่านสุขภาพระบบไม่ได้');}
}
async function loadOverviewSystem(){
 const root=document.querySelector('[data-overview-system]');if(!root)return;
 try{const data=await overviewRead('system');root.replaceChildren();for(const c of data.components)overviewCard(root,c.name,c.status==='LIVE'?'อ่านจุดเชื่อมต่อได้':'ยังตรวจการเชื่อมต่อไม่ได้',[displayTime(c.checkedAt)]);}catch{root.replaceChildren();overviewText(root,'p','ตอนนี้อ่านการเชื่อมต่อไม่ได้');}
}
function summaryLens(name,value,detail){
 const card=dailySummary?.querySelector(`[data-summary-lens="${name}"]`);if(!card)return;
 const strong=card.querySelector('strong'),paragraph=card.querySelector('p');if(strong)strong.textContent=String(value);if(paragraph)paragraph.textContent=String(detail);
}
async function loadDailySummary(){
 if(!dailySummary)return;
 try{
  const data=await overviewRead('summary');
  const partial=!(data.work.coverageComplete&&data.sales.coverageComplete&&data.money.coverageComplete);
  summaryLens('SALES',data.sales.briefsReceived+' บรีฟ',`Quote ร่าง ${data.sales.quoteDrafts} · ส่งแล้ว ${data.sales.quotesSent}${data.sales.coverageComplete?'':' · บางส่วน'}`);
  const totals=Object.entries(data.money.providerConfirmedByCurrency||{}).map(([currency,amount])=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(amount)+' '+currency).join(' · ');
  summaryLens('MONEY',totals?('หลักฐาน '+totals):'ยังไม่พบหลักฐานยอด',`สถานะจาก provider · รอ provider ${data.money.pending} · รอ GO review ${data.money.goReviewRequired}${data.money.coverageComplete?'':' · coverage ไม่ครบ'}`);
  summaryLens('WORK',data.work.active+' กำลังทำ',`รอ ${data.work.waiting} · UNKNOWN ${data.work.unknown} · อ่าน ${data.work.observed}/${data.work.total}`);
  summaryLens('SYSTEM',data.system.live+'/'+data.system.total+' LIVE',`UNKNOWN ${data.system.unknown}`);
  summaryLens('ATTENTION',data.attention.total,data.attention.total?`GO review · เงิน ${data.attention.moneyReview} · งาน ${data.attention.workUnknown+data.attention.ownerMismatches}${data.attention.coverageIncomplete?' · coverage ไม่ครบ':''}`:'ยังไม่มีจุดที่ต้องตรวจ');
  if(summaryStatus)summaryStatus.textContent=(partial?'PARTIAL COVERAGE · ':'ครบตามชุดข้อมูลที่อ่าน · ')+'Owner-source readback · อัปเดต '+displayTime(data.checkedAt);
  if(officePage==='home'){
   loadedWorks.clear();for(const work of data.worksPreview||[])loadedWorks.set(work.workId,work);renderOverviewWorks();
   if(overviewCoverage)overviewCoverage.textContent=`อ่าน ${data.work.observed}/${data.work.total} งานปัจจุบัน${data.work.coverageComplete?'':' · PARTIAL COVERAGE'}`;
   renderOverviewActivity({items:data.activity||[],checkedAt:data.checkedAt});
  }
 }catch{if(summaryStatus)summaryStatus.textContent='ตอนนี้อ่านสรุปไม่ได้ · สถานะ UNKNOWN';}
}
async function loadOverviewSales(append=false){
 if(!overviewSales)return;const status=document.querySelector('[data-overview-sales-status]');
 const payments=document.querySelector('[data-overview-payments]');
 try{const data=await overviewRead('sales'+(append&&salesCursor?'?cursor='+encodeURIComponent(salesCursor):''));if(!append)loadedSales.clear();for(const b of data.briefs)loadedSales.set(b.briefId,b);for(const e of data.events)loadedSales.set(e.eventId,e);salesCursor=data.nextCursor;if(salesMore)salesMore.hidden=!salesCursor;overviewSales.replaceChildren();overviewQuotes?.replaceChildren();payments?.replaceChildren();
 const briefs=[...loadedSales.values()].filter(i=>i.brief),events=[...loadedSales.values()].filter(i=>i.type);
 for(const item of briefs){const lines=Object.entries(item.brief).filter(([k,v])=>v&&k!=='goal').map(([k,v])=>(briefLabels[k]||k)+': '+v);const card=overviewCard(overviewSales,item.brief.goal||'บรีฟจากหน้าร้าน',item.status==='CONFIRMED'?'ลูกค้ายืนยันบรีฟแล้ว':'ร่างบรีฟ',lines);const details=document.createElement('details');overviewText(details,'summary','ดูข้อมูลการรับบรีฟ');overviewText(details,'code',item.briefId);overviewText(details,'p','เก็บข้อมูลเมื่อ '+displayTime(item.receivedAt));overviewText(details,'p',item.processing==='UNKNOWN'?'ยังไม่มีหลักฐานว่าประมวลผลต่อแล้ว':'สถานะต่อ: '+item.processing);card.append(details);}
 if(!briefs.length)overviewText(overviewSales,'p','ยังไม่มีบรีฟลูกค้าในรายการที่อ่าน');
 const views=events.filter(e=>e.type==='PAGE_VIEW').length,ctaClicks=events.filter(e=>e.type==='CTA_CLICK').length,interest=events.filter(e=>e.type==='SERVICE_INTEREST').length,started=events.filter(e=>e.type==='BRIEF_STARTED').length;
 status.textContent='ในรายการนี้: เปิดหน้า '+views+' → กดเริ่ม '+ctaClicks+' → สนใจบริการ '+interest+' → เริ่มบรีฟ '+started+' → บรีฟที่รับเข้า '+briefs.length;
 for(const q of data.quotes||[]){overviewCard(overviewQuotes,q.customerId+' · '+q.workId,q.status,[q.quoteId+' · '+q.amount+' '+q.currency,q.status==='QUOTE_SENT'?'ใช้สร้าง checkout ได้':'ยังเป็นร่าง ห้ามสร้าง checkout',q.sentAt?'ส่งเมื่อ '+displayTime(q.sentAt):'']);}
 if(overviewQuotes&&!(data.quotes||[]).length)overviewText(overviewQuotes,'p','ยังไม่มีใบเสนอราคาจาก Office','office-muted');
 for(const p of data.payments||[]){overviewCard(payments,p.customerId+' · '+p.workId,p.status,[p.quoteId+' · '+p.amount+' '+p.currency,'อ้างอิง '+(p.providerReference||'UNKNOWN'),'พร้อมเริ่มงาน '+p.fulfillmentReadiness,'หลักฐาน '+(p.evidenceFreshness?.state||'UNKNOWN')+' · '+displayTime(p.providerObservedAt),'ถัดไป '+p.nextAction]);}
 if(payments&&!(data.payments||[]).length)overviewText(payments,'p','ยังไม่มีรายการชำระเงินจาก provider','office-muted');
 }catch{status.textContent='ตอนนี้อ่านข้อมูลหน้าร้านไม่ได้'+(loadedSales.size?' · ด้านล่างเป็นข้อมูลครั้งก่อน':'');}
}
quoteForm?.addEventListener('submit',async event=>{event.preventDefault();const submit=quoteForm.querySelector('button[type="submit"]');submit.disabled=true;quoteStatus.textContent='กำลังบันทึก…';try{const form=new FormData(quoteForm),payload={quoteId:String(form.get('quoteId')||'').trim(),customerId:String(form.get('customerId')||'').trim(),workId:String(form.get('workId')||'').trim(),amount:Number(form.get('amount')),currency:String(form.get('currency')||'').trim().toUpperCase(),status:String(form.get('status')||'QUOTE_DRAFT')};const response=await fetch('/office/api/quotes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.code||'QUOTE_SAVE_FAILED');quoteStatus.textContent='บันทึก '+body.quote.quoteId+' แล้ว';await loadOverviewSales();}catch(error){quoteStatus.textContent='บันทึกไม่ได้: '+String(error.message||'UNKNOWN');}finally{submit.disabled=false;}});
async function refreshOverview(){
 if(overviewBusy)return;overviewBusy=true;const workTarget=loadedWorks.size,salesTarget=loadedSales.size;
 try{await Promise.all([loadDailySummary(),officePage==='home'?Promise.resolve():(async()=>{await loadOverviewWorks();while(overviewOffset!==null&&loadedWorks.size<workTarget){const before=overviewOffset;await loadOverviewWorks(true);if(before===overviewOffset)break;}})(),officePage==='home'?Promise.resolve():loadOverviewActivity(),loadOverviewHealth(),loadOverviewSystem(),(async()=>{await loadOverviewSales();while(salesCursor&&loadedSales.size<salesTarget){const before=salesCursor;await loadOverviewSales(true);if(before===salesCursor)break;}})()]);}finally{overviewBusy=false;}
}
document.querySelector('[data-overview-refresh]')?.addEventListener('click',refreshOverview);
overviewMore?.addEventListener('click',async()=>{overviewMore.disabled=true;try{await loadOverviewWorks(true);}finally{overviewMore.disabled=false;}});
salesMore?.addEventListener('click',async()=>{salesMore.disabled=true;try{await loadOverviewSales(true);}finally{salesMore.disabled=false;}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshOverview();});
setInterval(()=>{if(document.visibilityState==='visible')refreshOverview();},60000);
await refreshOverview();
