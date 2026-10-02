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
const passkeyButton=document.querySelector("[data-passkey-register]");
const passkeyStatus=document.querySelector("[data-passkey-status]");

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

refresh?.addEventListener("click",readEye);
passkeyButton?.addEventListener("click",registerPasskey);
await Promise.all([readEye(),readPasskeyStatus()]);
