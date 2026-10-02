"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const {webcrypto}=require("node:crypto");

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const moduleUrl=pathToFileURL(path.resolve(__dirname,"../go-hub-office-passkey.mjs")).href;

function storage(){
  const map=new Map();
  return {
    async get(k){return map.get(k)},
    async put(k,v){map.set(k,v)},
    async delete(k){map.delete(k)},
  };
}
function b64url(bytes){
  return Buffer.from(bytes).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function clientData(type,challenge,origin){
  return new TextEncoder().encode(JSON.stringify({type,challenge,origin,crossOrigin:false}));
}
async function authData(rpId,flags=0x05,count=0){
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(rpId)));
  const out=new Uint8Array(37);out.set(hash,0);out[32]=flags;
  new DataView(out.buffer).setUint32(33,count,false);return out;
}
function rawToDer(raw){
  const b=new Uint8Array(raw); const n=b.length/2;
  function enc(x){
    let a=Array.from(x);while(a.length>1&&a[0]===0)a.shift();
    if(a[0]&0x80)a.unshift(0);
    return Uint8Array.from([0x02,a.length,...a]);
  }
  const r=enc(b.slice(0,n)),s=enc(b.slice(n));
  return Uint8Array.from([0x30,r.length+s.length,...r,...s]);
}

test("Office passkey register then authenticate verifies a real P-256 signature",async()=>{
  const {OfficePasskeyState}=await import(moduleUrl+"?e2e="+Date.now());
  const state=new OfficePasskeyState({storage:storage()});
  const origin="https://office.yggmetro.com",rpId="office.yggmetro.com";
  const headers={"x-office-origin":origin};

  const ro=await state.fetch(new Request("https://office-passkey.internal/register/options",{method:"POST",headers}));
  assert.equal(ro.status,200);
  const roBody=await ro.json();
  const challenge=roBody.publicKey.challenge;

  const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const spki=new Uint8Array(await crypto.subtle.exportKey("spki",pair.publicKey));
  const regClient=clientData("webauthn.create",challenge,origin);
  const regAuth=await authData(rpId);

  const rv=await state.fetch(new Request("https://office-passkey.internal/register/verify",{
    method:"POST",headers:{...headers,"content-type":"application/json"},
    body:JSON.stringify({
      credentialId:"cred-1",
      clientDataJSON:b64url(regClient),
      publicKeySpki:b64url(spki),
      authenticatorData:b64url(regAuth),
      algorithm:-7,
      transports:["internal"],
    })
  }));
  assert.equal(rv.status,200);
  assert.equal((await rv.json()).registered,true);

  const ao=await state.fetch(new Request("https://office-passkey.internal/auth/options",{method:"POST",headers}));
  const aoBody=await ao.json();
  const authClient=clientData("webauthn.get",aoBody.publicKey.challenge,origin);
  const authAuth=await authData(rpId,0x05,1);
  const clientHash=new Uint8Array(await crypto.subtle.digest("SHA-256",authClient));
  const signed=new Uint8Array(authAuth.length+clientHash.length);signed.set(authAuth);signed.set(clientHash,authAuth.length);
  const rawSig=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},pair.privateKey,signed));
  const derSig=rawToDer(rawSig);

  const av=await state.fetch(new Request("https://office-passkey.internal/auth/verify",{
    method:"POST",headers:{...headers,"content-type":"application/json"},
    body:JSON.stringify({
      credentialId:"cred-1",
      clientDataJSON:b64url(authClient),
      authenticatorData:b64url(authAuth),
      signature:b64url(derSig),
    })
  }));
  assert.equal(av.status,200);
  assert.deepEqual(await av.json(),{ok:true,subject:"BIG"});
});

test("Office passkey rejects wrong RP authenticator data",async()=>{
  const {OfficePasskeyState}=await import(moduleUrl+"?rp="+Date.now());
  const state=new OfficePasskeyState({storage:storage()});
  const origin="https://office.yggmetro.com",headers={"x-office-origin":origin};
  const ro=await state.fetch(new Request("https://office-passkey.internal/register/options",{method:"POST",headers}));
  const challenge=(await ro.json()).publicKey.challenge;
  const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const spki=new Uint8Array(await crypto.subtle.exportKey("spki",pair.publicKey));
  const response=await state.fetch(new Request("https://office-passkey.internal/register/verify",{
    method:"POST",headers:{...headers,"content-type":"application/json"},
    body:JSON.stringify({
      credentialId:"cred-x",
      clientDataJSON:b64url(clientData("webauthn.create",challenge,origin)),
      publicKeySpki:b64url(spki),
      authenticatorData:b64url(await authData("evil.example")),
      algorithm:-7
    })
  }));
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{code:"PASSKEY_RP_ID"});
});
