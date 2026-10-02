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
const button=document.querySelector("[data-passkey-login]");
const status=document.querySelector("[data-passkey-login-status]");

async function passkeyLogin(){
  status.textContent="กำลังเปิด Passkey…";
  try{
    const optionsResponse=await fetch("/office/passkey/auth/options",{method:"POST",headers:{"content-type":"application/json"}});
    const optionsBody=await optionsResponse.json().catch(()=>({}));
    if(!optionsResponse.ok)throw new Error(optionsBody.code||"PASSKEY_OPTIONS_FAILED");
    const publicKey={...optionsBody.publicKey,challenge:b64urlToBytes(optionsBody.publicKey.challenge)};
    publicKey.allowCredentials=(publicKey.allowCredentials||[]).map(item=>({...item,id:b64urlToBytes(item.id)}));
    const credential=await navigator.credentials.get({publicKey});
    if(!credential)throw new Error("PASSKEY_CANCELLED");
    const response=credential.response;
    const verifyResponse=await fetch("/office/passkey/auth/verify",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        credentialId:credential.id,
        clientDataJSON:bytesToB64url(response.clientDataJSON),
        authenticatorData:bytesToB64url(response.authenticatorData),
        signature:bytesToB64url(response.signature),
        userHandle:response.userHandle?bytesToB64url(response.userHandle):null
      })
    });
    const verifyBody=await verifyResponse.json().catch(()=>({}));
    if(!verifyResponse.ok||verifyBody.ok!==true)throw new Error(verifyBody.code||"PASSKEY_VERIFY_FAILED");
    location.assign(verifyBody.redirect||"/office");
  }catch(error){
    status.textContent=error instanceof Error?error.message:String(error);
  }
}

async function init(){
  if(!window.PublicKeyCredential||!navigator.credentials){
    status.textContent="อุปกรณ์นี้ยังไม่รองรับ Passkey";
    return;
  }
  try{
    const response=await fetch("/office/passkey/status",{cache:"no-store"});
    const body=await response.json().catch(()=>({}));
    if(response.ok&&body.registered){
      button.hidden=false;
      status.textContent="Passkey พร้อมใช้งาน";
    }else{
      status.textContent="เข้าด้วย bootstrap passcode ครั้งแรก แล้วสร้าง Passkey ใน Office";
    }
  }catch{
    status.textContent="ตรวจ Passkey ไม่ได้";
  }
}
button?.addEventListener("click",passkeyLogin);
await init();
