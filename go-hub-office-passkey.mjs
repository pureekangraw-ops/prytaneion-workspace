const CREDENTIAL_KEY="office-passkey-credential-v1";
const CHALLENGE_KEY="office-passkey-challenge-v1";
const CHALLENGE_TTL_MS=5*60*1000;

function json(payload,status=200){
  return new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
function clean(value,max=512){return String(value==null?"":value).trim().slice(0,max)}
function bytesToB64url(bytes){
  let s=""; for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function b64urlToBytes(value){
  const s=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
  const p=s+"=".repeat((4-s.length%4)%4);
  const bin=atob(p); return Uint8Array.from(bin,c=>c.charCodeAt(0));
}
async function sha256(bytes){return new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))}
function equalBytes(a,b){
  if(a.length!==b.length)return false;
  let diff=0; for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}
function derToRaw(sig,size=32){
  const b=sig instanceof Uint8Array?sig:new Uint8Array(sig);
  if(b[0]!==0x30)throw new Error("PASSKEY_SIGNATURE_FORMAT");
  let i=1;
  let seqLen=b[i++]; if(seqLen&0x80){let n=seqLen&0x7f;seqLen=0;while(n--){seqLen=(seqLen<<8)|b[i++]}}
  if(b[i++]!==0x02)throw new Error("PASSKEY_SIGNATURE_FORMAT");
  let rLen=b[i++],r=b.slice(i,i+rLen);i+=rLen;
  if(b[i++]!==0x02)throw new Error("PASSKEY_SIGNATURE_FORMAT");
  let sLen=b[i++],s=b.slice(i,i+sLen);
  while(r.length>size&&r[0]===0)r=r.slice(1);
  while(s.length>size&&s[0]===0)s=s.slice(1);
  if(r.length>size||s.length>size)throw new Error("PASSKEY_SIGNATURE_FORMAT");
  const out=new Uint8Array(size*2);
  out.set(r,size-r.length); out.set(s,size*2-s.length); return out;
}
function parseClientData(encoded){
  const bytes=b64urlToBytes(encoded);
  const text=new TextDecoder().decode(bytes);
  return {bytes,data:JSON.parse(text)};
}
function requireClientData(encoded,{type,challenge,origin}){
  const parsed=parseClientData(encoded);
  if(parsed.data?.type!==type)throw new Error("PASSKEY_CLIENT_TYPE");
  if(clean(parsed.data?.challenge,256)!==challenge)throw new Error("PASSKEY_CHALLENGE");
  if(clean(parsed.data?.origin,512)!==origin)throw new Error("PASSKEY_ORIGIN");
  return parsed.bytes;
}
async function verifyAuthenticatorData(encoded,rpId){
  const bytes=b64urlToBytes(encoded);
  if(bytes.length<37)throw new Error("PASSKEY_AUTH_DATA");
  const expected=await sha256(new TextEncoder().encode(rpId));
  if(!equalBytes(bytes.slice(0,32),expected))throw new Error("PASSKEY_RP_ID");
  const flags=bytes[32];
  if((flags&0x01)===0)throw new Error("PASSKEY_USER_PRESENCE");
  if((flags&0x04)===0)throw new Error("PASSKEY_USER_VERIFICATION");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return {bytes,signCount:view.getUint32(33,false)};
}
function challenge(){
  const bytes=new Uint8Array(32); crypto.getRandomValues(bytes); return bytesToB64url(bytes);
}
function userId(){
  const bytes=new Uint8Array(32); crypto.getRandomValues(bytes); return bytesToB64url(bytes);
}
function rpIdFromOrigin(origin){
  const url=new URL(origin);
  if(url.protocol!=="https:")throw new Error("PASSKEY_HTTPS_REQUIRED");
  return url.hostname;
}

export class OfficePasskeyState{
  constructor(ctx){this.ctx=ctx}

  async fetch(request){
    try{
      const url=new URL(request.url);
      const origin=clean(request.headers.get("x-office-origin"),512);
      if(!origin)return json({code:"PASSKEY_ORIGIN_REQUIRED"},400);
      const rpId=rpIdFromOrigin(origin);
      const credential=await this.ctx.storage.get(CREDENTIAL_KEY);

      if(request.method==="GET"&&url.pathname==="/status"){
        return json({ok:true,registered:Boolean(credential),rpId});
      }

      if(request.method==="POST"&&url.pathname==="/register/options"){
        const c=challenge();
        const uid=credential?.userId||userId();
        await this.ctx.storage.put(CHALLENGE_KEY,{type:"register",challenge:c,origin,rpId,expiresAt:Date.now()+CHALLENGE_TTL_MS,userId:uid});
        return json({ok:true,publicKey:{
          challenge:c,
          rp:{name:"YGG METRO Office",id:rpId},
          user:{id:uid,name:"big@yggmetro.com",displayName:"BIG"},
          pubKeyCredParams:[{type:"public-key",alg:-7}],
          authenticatorSelection:{residentKey:"preferred",userVerification:"required"},
          timeout:60000,
          attestation:"none"
        }});
      }

      if(request.method==="POST"&&url.pathname==="/register/verify"){
        const state=await this.ctx.storage.get(CHALLENGE_KEY);
        if(!state||state.type!=="register"||state.expiresAt<Date.now())return json({code:"PASSKEY_CHALLENGE_EXPIRED"},400);
        if(state.origin!==origin||state.rpId!==rpId)return json({code:"PASSKEY_ORIGIN"},403);
        const body=await request.json().catch(()=>null);
        if(!body||typeof body!=="object"||Array.isArray(body))return json({code:"INVALID_JSON"},400);
        requireClientData(body.clientDataJSON,{type:"webauthn.create",challenge:state.challenge,origin});
        await verifyAuthenticatorData(body.authenticatorData,rpId);
        const credentialId=clean(body.credentialId,512);
        const publicKeySpki=clean(body.publicKeySpki,8192);
        if(!credentialId||!publicKeySpki)return json({code:"PASSKEY_REGISTRATION_DATA_REQUIRED"},400);
        const algorithm=Number(body.algorithm);
        if(algorithm!==-7)return json({code:"PASSKEY_ALGORITHM_UNSUPPORTED"},400);
        const record={
          credentialId,publicKeySpki,algorithm,
          transports:Array.isArray(body.transports)?body.transports.map(v=>clean(v,40)).filter(Boolean).slice(0,8):[],
          userId:state.userId,
          signCount:0,
          createdAt:new Date().toISOString()
        };
        await this.ctx.storage.put(CREDENTIAL_KEY,record);
        await this.ctx.storage.delete(CHALLENGE_KEY);
        return json({ok:true,registered:true});
      }

      if(request.method==="POST"&&url.pathname==="/auth/options"){
        if(!credential)return json({code:"PASSKEY_NOT_REGISTERED"},404);
        const c=challenge();
        await this.ctx.storage.put(CHALLENGE_KEY,{type:"auth",challenge:c,origin,rpId,expiresAt:Date.now()+CHALLENGE_TTL_MS});
        return json({ok:true,publicKey:{
          challenge:c,
          rpId,
          allowCredentials:[{type:"public-key",id:credential.credentialId,transports:credential.transports||[]}],
          userVerification:"required",
          timeout:60000
        }});
      }

      if(request.method==="POST"&&url.pathname==="/auth/verify"){
        if(!credential)return json({code:"PASSKEY_NOT_REGISTERED"},404);
        const state=await this.ctx.storage.get(CHALLENGE_KEY);
        if(!state||state.type!=="auth"||state.expiresAt<Date.now())return json({code:"PASSKEY_CHALLENGE_EXPIRED"},400);
        if(state.origin!==origin||state.rpId!==rpId)return json({code:"PASSKEY_ORIGIN"},403);
        const body=await request.json().catch(()=>null);
        if(!body||typeof body!=="object"||Array.isArray(body))return json({code:"INVALID_JSON"},400);
        if(clean(body.credentialId,512)!==credential.credentialId)return json({code:"PASSKEY_CREDENTIAL_MISMATCH"},403);
        const clientBytes=requireClientData(body.clientDataJSON,{type:"webauthn.get",challenge:state.challenge,origin});
        const auth=await verifyAuthenticatorData(body.authenticatorData,rpId);
        const clientHash=await sha256(clientBytes);
        const signed=new Uint8Array(auth.bytes.length+clientHash.length);
        signed.set(auth.bytes,0);signed.set(clientHash,auth.bytes.length);
        const key=await crypto.subtle.importKey("spki",b64urlToBytes(credential.publicKeySpki),{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
        const ok=await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},key,derToRaw(b64urlToBytes(body.signature)),signed);
        if(!ok)return json({code:"PASSKEY_SIGNATURE_INVALID"},403);
        await this.ctx.storage.put(CREDENTIAL_KEY,{...credential,signCount:auth.signCount,lastUsedAt:new Date().toISOString()});
        await this.ctx.storage.delete(CHALLENGE_KEY);
        return json({ok:true,subject:"BIG"});
      }

      return json({code:"NOT_FOUND"},404);
    }catch(error){
      const code=clean(error?.message||"PASSKEY_ERROR",120)||"PASSKEY_ERROR";
      return json({code},400);
    }
  }
}

export function createOfficePasskeyService({namespace=null}={}){
  function target(){
    if(!namespace||typeof namespace.getByName!=="function")return null;
    return namespace.getByName("office-passkey-v1");
  }
  async function call(path,{method="GET",origin,body=null}={}){
    const stub=target();
    if(!stub)return json({code:"OFFICE_PASSKEY_NOT_CONFIGURED"},503);
    const headers={"x-office-origin":origin};
    if(body!==null)headers["content-type"]="application/json";
    return stub.fetch(new Request("https://office-passkey.internal"+path,{method,headers,body:body===null?undefined:JSON.stringify(body)}));
  }
  return Object.freeze({
    status:origin=>call("/status",{origin}),
    registerOptions:origin=>call("/register/options",{method:"POST",origin}),
    verifyRegistration:(origin,body)=>call("/register/verify",{method:"POST",origin,body}),
    authOptions:origin=>call("/auth/options",{method:"POST",origin}),
    verifyAuthentication:(origin,body)=>call("/auth/verify",{method:"POST",origin,body}),
  });
}
