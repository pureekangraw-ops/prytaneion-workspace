import { DEFAULT_SESSION_TTL_MS } from "./go-hub-lighthouse-control-port-session.js";
import {
  LIGHTHOUSE_TRANSFER_CONTRACT,
  listLighthouseTransferCapabilities,
  normalizeLighthouseTransferEnvelope,
} from "./go-hub-lighthouse-transfer.mjs";

export const LIGHTHOUSE_CONTROL_PORT_API_ROOT = "/hub/api/lighthouse-control-port";
export const LIGHTHOUSE_CONTROL_PORT_OWNER_PATH = "/hub/lighthouse";
const SESSION_NAME = "lighthouse-control-port-v1";
const encoder = new TextEncoder();

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", ...headers },
  });
}
function clean(value) { return String(value == null ? "" : value).trim(); }
function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left || ""));
  const b = encoder.encode(String(right || ""));
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length, 1);
  for (let i = 0; i < len; i += 1) {
    diff |= (a[i % Math.max(a.length, 1)] || 0) ^ (b[i % Math.max(b.length, 1)] || 0);
  }
  return diff === 0;
}
function statusFor(code) {
  if (code === "SCHEMA_REJECTED") return 400;
  if (code === "REQUEST_ID_CONFLICT") return 409;
  if (code === "COMMAND_NOT_FOUND") return 404;
  if (code === "SESSION_EXPIRED") return 410;
  if (code === "SESSION_INACTIVE") return 403;
  return 503;
}
function stub(namespace) {
  if (!namespace || typeof namespace.getByName !== "function") return null;
  const durable = namespace.getByName(SESSION_NAME);
  if (!durable || typeof durable.fetch !== "function") return null;

  async function call(path, input = {}) {
    const response = await durable.fetch(new Request(`https://lighthouse-control-port.internal/${path}`, {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify(input),
    }));
    const raw = await response.text();
    let body;
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error("DURABLE_OBJECT_NON_JSON"); }
    if (!response.ok) throw new Error(body?.code || "DURABLE_OBJECT_ERROR");
    return body;
  }

  return Object.freeze({
    start:input => call("start", input),
    enqueue:input => call("enqueue", input),
    pull:input => call("pull", input),
    pushReceipts:input => call("receipts", input),
    pushState:input => call("state", input),
    latest:() => call("latest"),
    board:input => call("board", input),
    latestBoard:() => call("board/latest"),
    projectCentre:view => call("board/project", { view }),
    stop:input => call("stop", input),
    live:request => durable.fetch(new Request("https://lighthouse-control-port.internal/live", request)),
  });
}
function credentials(request) {
  return {
    sessionId:clean(request.headers.get("x-lighthouse-session-id")),
    sessionToken:clean(request.headers.get("x-lighthouse-session-token")),
  };
}
function nativeCors(request) {
  const origin = clean(request.headers.get("origin"));
  if (!origin) return {};
  const requestOrigin = new URL(request.url).origin;
  const allowed = new Set([requestOrigin, "https://localhost", "http://localhost", "capacitor://localhost"]);
  if (!allowed.has(origin)) return null;
  return {
    "access-control-allow-origin":origin,
    "access-control-allow-methods":"GET, POST, OPTIONS",
    "access-control-allow-headers":"content-type, x-lighthouse-session-id, x-lighthouse-session-token, x-go-owner-passcode",
    "access-control-max-age":"600",
    "vary":"Origin",
  };
}

export function lighthouseControlPortOwnerPage() {
  const catalog = JSON.stringify(listLighthouseTransferCapabilities());
  return new Response(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LIGHTHOUSE Control Room</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0d1016;color:#eef2f7}
body{margin:0}.wrap{max-width:1120px;margin:0 auto;padding:28px 18px 60px}.status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.status-tile{padding:14px;border:1px solid #343b48;border-radius:12px;background:#10141b}.status-tile span{display:block;font-size:.72rem;opacity:.62}.status-tile strong{display:block;margin-top:6px;overflow-wrap:anywhere}.room-rule{padding:12px 14px;border:1px solid #664;border-radius:12px;background:#1b1910}
h1{margin:0 0 8px}.muted{opacity:.72}.card{margin-top:18px;padding:18px;border:1px solid #343b48;border-radius:16px;background:#151922}
form,.grid{display:grid;gap:12px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}
label{display:grid;gap:6px;font-size:.82rem}input,select,textarea,button{font:inherit}
input,select,textarea{box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #424b5b;border-radius:10px;background:#0f131a;color:#eef2f7}
textarea{resize:vertical}button{padding:11px 14px;border:0;border-radius:10px;font-weight:750;cursor:pointer}
.primary{background:#f0c96a;color:#111318}.secondary{background:#e9edf2;color:#111318}.buttons{display:flex;flex-wrap:wrap;gap:8px}
.route{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}
.route div{padding:10px;border:1px solid #303745;border-radius:10px;min-width:0}.route span{display:block;font-size:.7rem;opacity:.62}.route strong{display:block;margin-top:4px;overflow-wrap:anywhere}
.status{min-height:1.4em;margin:10px 0 0}.file{padding:10px;border:1px dashed #424b5b;border-radius:10px}
@media(max-width:680px){.grid,.route,.status-grid{grid-template-columns:1fr}.buttons button{flex:1 1 100%}}
</style>
</head>
<body><main class="wrap">
<h1>LIGHTHOUSE Control Room</h1>
<p class="muted">Closed app-control room. Inspect LIGHTHOUSE reality, send app data, receive reports, and use LIGHTHOUSE-only diagnostics.</p>
<p class="room-rule"><strong>Room rule:</strong> LIGHTHOUSE has one exit: Return Centre. External repair work never opens another room from here.</p>
<section class="card"><h2>Live Reality Board</h2><div class="status-grid"><div class="status-tile"><span>Work</span><strong id="room-work">UNKNOWN</strong></div><div class="status-tile"><span>Holder</span><strong id="room-actor">UNKNOWN</strong></div><div class="status-tile"><span>Session</span><strong id="live-session">UNKNOWN</strong></div><div class="status-tile"><span>Revision</span><strong id="live-revision">UNKNOWN</strong></div><div class="status-tile"><span>Last seen</span><strong id="live-seen">UNKNOWN</strong></div><div class="status-tile"><span>Last report</span><strong id="live-report">UNKNOWN</strong></div></div><div class="buttons" style="margin-top:12px"><button class="secondary" id="refresh-reality" type="button">Refresh Reality</button><button class="secondary" id="return-centre" type="button">Return Centre</button></div><p id="reality-status" class="status"></p></section>

<section class="card">
<h2>Device pairing</h2>
<form id="pair">
<label>Owner passcode <input id="passcode" type="password" autocomplete="current-password" required></label>
<label>Device label <input id="label" value="LIGHTHOUSE Android" maxlength="120"></label>
<button class="secondary" type="submit">Create bootstrap</button>
</form>
<label>Bootstrap <textarea id="bootstrap" readonly rows="5"></textarea></label>
<p id="status" class="status"></p>
</section>

<section class="card">
<h2>LIGHTHOUSE Transfer Form · Data Drop → LIGHTHOUSE</h2>
<p class="muted">38 capabilities are shown. Read-only and device-secret capabilities stay visible but cannot be queued. Exported JSON carries the route metadata with the payload.</p>
<form id="transfer">
<div class="grid">
<label>Request ID <input id="transfer-request" required></label>
<label>Destination / capability <select id="transfer-capability" required></select></label>
</div>
<div class="route">
<div><span>Owner</span><strong id="route-owner">—</strong></div>
<div><span>Action</span><strong id="route-action">—</strong></div>
<div><span>Readback</span><strong id="route-readback">—</strong></div>
<div><span>Guard</span><strong id="route-guard">—</strong></div>
</div>
<label>Payload JSON <textarea id="transfer-payload" rows="12" spellcheck="false">{}</textarea></label>
<label>Owner passcode for Send <input id="transfer-passcode" type="password" autocomplete="current-password"></label>
<div class="buttons">
<button class="primary" type="submit">Send to LIGHTHOUSE</button>
<button class="secondary" id="transfer-export" type="button">Export JSON</button>
<label class="file">Import JSON <input id="transfer-import" type="file" accept=".json,application/json"></label>
</div>
<p id="transfer-status" class="status"></p>
</form>
</section>

<section class="card"><h2>Report Inbox + LIGHTHOUSE Maintenance</h2><p class="muted">Returned app reports and app state stay inside this room. Diagnostics use LIGHTHOUSE-only READ / PREFLIGHT / SAFE TEST. No cross-room Service Path and no auto-repair.</p><div class="buttons"><button class="secondary" id="run-lighthouse-check" type="button">Run LIGHTHOUSE Check</button></div><label>Returned Reports<textarea id="report-inbox" readonly rows="8">Refresh Reality to inspect returned reports.</textarea></label><label>Latest App State<textarea id="app-state" readonly rows="8">Refresh Reality to inspect current app state.</textarea></label><label>Diagnostic Trace<textarea id="diagnostic-trace" readonly rows="8">Run LIGHTHOUSE Check for a bounded reality check.</textarea></label></section>

<script>
const realityStatus=document.getElementById('reality-status');
const roomParams=new URLSearchParams(location.search);
const roomWorkId=String(roomParams.get('work_id')||'').trim();
const roomActor=String(roomParams.get('actor')||'').trim();
document.getElementById('room-work').textContent=roomWorkId||'UNKNOWN';
document.getElementById('room-actor').textContent=roomActor||'UNKNOWN';
const roomQuery='?work_id='+encodeURIComponent(roomWorkId)+'&actor='+encodeURIComponent(roomActor);
let latestLighthouseReality=null;
async function readLighthouseReality(){
  const r=await fetch('/hub/api/lighthouse-control-port/owner-state'+roomQuery,{method:'POST',headers:{'content-type':'application/json','x-go-owner-passcode':document.getElementById('passcode')?.value||''},body:'{}'});
  const raw=await r.text();let b={};try{b=raw?JSON.parse(raw):{};}catch{throw new Error('REALITY_NON_JSON_'+r.status);}
  if(!r.ok)throw new Error(b.code||'REALITY_READ_FAILED');
  latestLighthouseReality=b;return b;
}
function renderLighthouseReality(b){
  document.getElementById('live-session').textContent=b.sourceStatus||'UNKNOWN';
  document.getElementById('live-revision').textContent=String(b.board?.revision??'UNKNOWN');
  document.getElementById('live-seen').textContent=b.session?.lastSeenAt||'UNKNOWN';
  const receipts=Array.isArray(b.receipts)?b.receipts:[];
  document.getElementById('live-report').textContent=receipts.length?String(receipts.at(-1)?.receiptAt||receipts.at(-1)?.at||'RECEIVED'):'NONE';
  document.getElementById('report-inbox').value=JSON.stringify(receipts,null,2);
  document.getElementById('app-state').value=JSON.stringify(b.appState??null,null,2);
}
async function refreshReality(){realityStatus.textContent='Reading owner-source reality…';try{const b=await readLighthouseReality();renderLighthouseReality(b);realityStatus.textContent='Reality refreshed.';}catch(err){realityStatus.textContent=err.message||'REALITY_READ_FAILED';}}
document.getElementById('refresh-reality').addEventListener('click',refreshReality);
document.getElementById('run-lighthouse-check').addEventListener('click',async()=>{realityStatus.textContent='Running LIGHTHOUSE-only check…';try{const b=await readLighthouseReality();renderLighthouseReality(b);const checks=[{point:'CONTROL_PORT_SESSION',status:b.sourceStatus==='ACTIVE'?'PASS':(b.sourceStatus||'UNKNOWN'),observed:b.sourceStatus||'UNKNOWN'},{point:'LIVE_BOARD',status:Number.isSafeInteger(Number(b.board?.revision))?'PASS':'UNKNOWN',observed:b.board?.revision??null},{point:'APP_STATE',status:b.appState==null?'UNKNOWN':'PASS',observed:b.appState==null?'NOT_REPORTED':'PRESENT'},{point:'REPORT_RETURN',status:Array.isArray(b.receipts)&&b.receipts.length?'PASS':'UNKNOWN',observed:Array.isArray(b.receipts)?b.receipts.length:0}];document.getElementById('diagnostic-trace').value=JSON.stringify({scope:'LIGHTHOUSE_ONLY',mode:'READ_PREFLIGHT_SAFE_TEST',autoRepair:false,crossRoomServicePath:false,checkedAt:new Date().toISOString(),checks},null,2);realityStatus.textContent='LIGHTHOUSE check complete. No cross-room action was taken.';}catch(err){document.getElementById('diagnostic-trace').value=JSON.stringify({scope:'LIGHTHOUSE_ONLY',status:'UNKNOWN',error:err.message||'REALITY_READ_FAILED'},null,2);realityStatus.textContent=err.message||'REALITY_READ_FAILED';}});
document.getElementById('return-centre').addEventListener('click',async()=>{realityStatus.textContent='Returning to Centre…';try{const r=await fetch('/hub/api/centre/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'v4_return',workId:roomWorkId,actor:roomActor,status:'OPEN',result:{room:'LIGHTHOUSE_CONTROL_ROOM',outcome:'RETURNED_TO_CENTRE'}})});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.code||b.message||'CENTRE_RETURN_FAILED');realityStatus.textContent='Returned to Centre. LIGHTHOUSE Pass closed on the same Work.';document.getElementById('return-centre').disabled=true;document.getElementById('refresh-reality').disabled=true;}catch(err){realityStatus.textContent=err.message||'CENTRE_RETURN_FAILED';}});
const TRANSFER_CONTRACT="lighthouse-transfer-v1";
const catalog=${catalog};
const pair=document.getElementById('pair'),bootstrap=document.getElementById('bootstrap'),pairStatus=document.getElementById('status');
pair.addEventListener('submit',async e=>{e.preventDefault();bootstrap.value='';pairStatus.textContent='Creating…';try{const r=await fetch('/hub/api/lighthouse-control-port/session/start',{method:'POST',headers:{'content-type':'application/json','x-go-owner-passcode':document.getElementById('passcode').value},body:JSON.stringify({device_label:document.getElementById('label').value})});const raw=await r.text();let b=null;try{b=raw?JSON.parse(raw):{};}catch{throw new Error('PAIRING_NON_JSON_'+r.status+': '+raw.slice(0,160));}document.getElementById('passcode').value='';if(!r.ok)throw new Error((b.code||'PAIRING_FAILED')+(b.reason?': '+b.reason:''));bootstrap.value=JSON.stringify(b,null,2);pairStatus.textContent='Bootstrap ready.';}catch(err){document.getElementById('passcode').value='';pairStatus.textContent=err.message||'PAIRING_FAILED';}});

const transfer=document.getElementById('transfer');
const capability=document.getElementById('transfer-capability');
const request=document.getElementById('transfer-request');
const payload=document.getElementById('transfer-payload');
const transferPasscode=document.getElementById('transfer-passcode');
const transferStatus=document.getElementById('transfer-status');
const ownerNode=document.getElementById('route-owner');
const actionNode=document.getElementById('route-action');
const readbackNode=document.getElementById('route-readback');
const guardNode=document.getElementById('route-guard');

function newRequestId(){return 'LH-'+Date.now().toString(36).toUpperCase();}
function selected(){return catalog.find(item=>item.id===capability.value)||null;}
function routeOf(item){return {owner:item.owner,action:item.action,readback:item.readback,confirmationRequired:item.confirmationRequired};}
function packet(){
  const item=selected();
  if(!item||item.editable!==true) throw new Error('DESTINATION_NOT_WRITABLE');
  let body={};try{body=JSON.parse(payload.value||'{}');}catch{throw new Error('PAYLOAD_JSON_INVALID');}
  if(!body||typeof body!=='object'||Array.isArray(body)) throw new Error('PAYLOAD_JSON_OBJECT_REQUIRED');
  return {contract:TRANSFER_CONTRACT,targetId:'lighthouse',requestId:request.value.trim(),capabilityId:item.id,route:routeOf(item),payload:body};
}
function renderRoute({resetPayload=true}={}){
  const item=selected();
  ownerNode.textContent=item?.owner||'—';
  actionNode.textContent=item?.action||'READ ONLY';
  readbackNode.textContent=item?.readback||'—';
  guardNode.textContent=item ? (item.editable ? (item.confirmationRequired?'CONFIRM ON DEVICE':'DIRECT') : (item.readable?'READ ONLY':'LOCKED')) : '—';
  if(resetPayload&&item) payload.value=JSON.stringify(item.payloadTemplate||{},null,2);
}
for(const item of catalog){
  const option=document.createElement('option');
  option.value=item.id;
  option.textContent=item.id+' · '+(item.editable?'WRITE':item.readable?'READ ONLY':'LOCKED');
  if(!item.editable) option.disabled=true;
  capability.append(option);
}
request.value=newRequestId();
capability.value=(catalog.find(item=>item.id==='finance.expense.create')||catalog.find(item=>item.editable))?.id||'';
renderRoute();
capability.addEventListener('change',()=>renderRoute());

document.getElementById('transfer-export').addEventListener('click',()=>{
  try{
    const value={...packet(),exportedAt:new Date().toISOString()};
    const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=(value.requestId||'lighthouse-transfer')+'.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
    transferStatus.textContent='Exported '+a.download;
  }catch(err){transferStatus.textContent=err.message||'EXPORT_FAILED';}
});

document.getElementById('transfer-import').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const value=JSON.parse(await file.text());
    if(value?.contract!==TRANSFER_CONTRACT||String(value?.targetId||'').toLowerCase()!=='lighthouse') throw new Error('TRANSFER_FILE_CONTRACT_INVALID');
    const item=catalog.find(entry=>entry.id===value.capabilityId);
    if(!item||item.editable!==true) throw new Error('TRANSFER_FILE_DESTINATION_INVALID');
    capability.value=item.id;request.value=String(value.requestId||newRequestId());payload.value=JSON.stringify(value.payload||{},null,2);renderRoute({resetPayload:false});
    transferStatus.textContent='Imported '+file.name;
  }catch(err){transferStatus.textContent=err.message||'IMPORT_FAILED';}
  e.target.value='';
});

transfer.addEventListener('submit',async e=>{
  e.preventDefault();transferStatus.textContent='Sending…';
  try{
    const value=packet();
    const r=await fetch('/hub/api/lighthouse-control-port/owner-command'+roomQuery,{method:'POST',headers:{'content-type':'application/json','x-go-owner-passcode':transferPasscode.value},body:JSON.stringify(value)});
    const raw=await r.text();let b={};try{b=raw?JSON.parse(raw):{};}catch{throw new Error('TRANSFER_NON_JSON_'+r.status);}
    transferPasscode.value='';
    if(!r.ok)throw new Error(b.code||'TRANSFER_SEND_FAILED');
    transferStatus.textContent='Queued '+b.requestId+' → '+b.capabilityId;
    request.value=newRequestId();
  }catch(err){transferPasscode.value='';transferStatus.textContent=err.message||'TRANSFER_SEND_FAILED';}
});
</script>
</main></body></html>`, {
    headers:{ "content-type":"text/html; charset=utf-8", "cache-control":"no-store" },
  });
}

export function createLighthouseControlPortHttpService({ namespace, ownerPasscode, prismService = null } = {}) {
  return Object.freeze({
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === LIGHTHOUSE_CONTROL_PORT_OWNER_PATH) {
        return lighthouseControlPortOwnerPage();
      }
      if (!url.pathname.startsWith(LIGHTHOUSE_CONTROL_PORT_API_ROOT + "/")) return json({ code:"NOT_FOUND" }, 404);

      const cors = nativeCors(request);
      if (request.method === "OPTIONS") {
        return cors === null ? json({ code:"ORIGIN_NOT_ALLOWED" }, 403) : new Response(null, { status:204, headers:cors });
      }
      if (cors === null) return json({ code:"ORIGIN_NOT_ALLOWED" }, 403);

      const sessions = stub(namespace);
      if (!sessions) return json({ code:"HUB_UNAVAILABLE" }, 503, cors || {});

      if (url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/live`) {
        const upgrade = clean(request.headers.get("upgrade")).toLowerCase();
        if (request.method !== "GET" || upgrade !== "websocket") {
          return json({ code:"WEBSOCKET_UPGRADE_REQUIRED" }, 426, cors || {});
        }
        return sessions.live(request);
      }

      if (request.method !== "POST") return json({ code:"METHOD_NOT_ALLOWED" }, 405, cors || {});

      if (url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/owner-state`) {
        const configured = clean(ownerPasscode);
        const supplied = clean(request.headers.get("x-go-owner-passcode"));
        if (!configured) return json({ code:"OWNER_AUTH_NOT_CONFIGURED" }, 503);
        if (!constantTimeEqual(supplied, configured)) return json({ code:"OWNER_AUTH_FAILED" }, 403);
        try {
          const latest = await sessions.latest();
          const board = await sessions.latestBoard();
          return json({
            ok:true,
            sourceStatus:latest?.ok === true ? "ACTIVE" : clean(latest?.code) || "UNKNOWN",
            session:latest?.session || null,
            appState:latest?.latest ?? null,
            commands:Array.isArray(latest?.commands) ? latest.commands : [],
            receipts:Array.isArray(latest?.receipts) ? latest.receipts : [],
            reconciliation:latest?.reconciliation || null,
            board:board?.board || latest?.board || null,
          }, 200);
        } catch (error) { return json({ code:clean(error?.message || "HUB_UNAVAILABLE") }, 503); }
      }

      if (url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/owner-command`) {
        const configured = clean(ownerPasscode);
        const supplied = clean(request.headers.get("x-go-owner-passcode"));
        if (!configured) return json({ code:"OWNER_AUTH_NOT_CONFIGURED" }, 503);
        if (!constantTimeEqual(supplied, configured)) return json({ code:"OWNER_AUTH_FAILED" }, 403);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code:"INVALID_JSON" }, 400);
        let envelope;
        try {
          envelope = normalizeLighthouseTransferEnvelope(body);
        } catch (error) {
          return json({ code:clean(error?.message || "LIGHTHOUSE_TRANSFER_INVALID") }, Number(error?.status) || 400);
        }
        try {
          const result = await sessions.enqueue({
            requestId:envelope.requestId,
            capabilityId:envelope.capabilityId,
            payload:envelope.payload,
          });
          if (!result?.ok) return json({ code:result?.code || "HUB_UNAVAILABLE" }, statusFor(result?.code));
          return json({
            ok:true,
            contract:envelope.contract,
            targetId:envelope.targetId,
            requestId:envelope.requestId,
            capabilityId:envelope.capabilityId,
            route:envelope.route,
            queuedAt:result.queuedAt || null,
          }, 200);
        } catch (error) {
          const code = clean(error?.message || "HUB_UNAVAILABLE");
          return json({ code }, statusFor(code));
        }
      }

      if (url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/session/start`) {
        const configured = clean(ownerPasscode);
        const supplied = clean(request.headers.get("x-go-owner-passcode"));
        if (!configured) return json({ code:"OWNER_AUTH_NOT_CONFIGURED" }, 503);
        if (!constantTimeEqual(supplied, configured)) return json({ code:"OWNER_AUTH_FAILED" }, 403);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code:"INVALID_JSON" }, 400);
        let result;
        try {
          result = await sessions.start({
            deviceLabel:clean(body.device_label) || "LIGHTHOUSE Android",
            ttlMs:DEFAULT_SESSION_TTL_MS,
          });
        } catch (error) {
          return json({
            code:"PAIRING_RUNTIME_ERROR",
            reason:clean(error?.message || error || "unknown").slice(0,160),
          }, 500);
        }
        if (!result?.ok) return json({ code:result?.code || "HUB_UNAVAILABLE" }, statusFor(result?.code));
        return json({
          ...result,
          hub_origin:url.origin,
          contract:"lighthouse-control-port-v1",
        }, 200);
      }

      const auth = credentials(request);
      if (!auth.sessionId || !auth.sessionToken) return json({ code:"SESSION_INACTIVE" }, 403, cors || {});

      if (['ask','handoff','result'].some(action => url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/prism/${action}`)) {
        try {
          // Reuse the durable owner-paired session check, including expiry.
          const authorized = await sessions.board(auth);
          if (!authorized?.ok) return json({code:authorized?.code||'SESSION_INACTIVE'},statusFor(authorized?.code),cors||{});
          if (!prismService?.handle) return json({code:'PRISM_RETURN_CHANNEL_UNAVAILABLE'},503,cors||{});
          const body=await request.json().catch(()=>null);
          if (!body||typeof body!=='object'||Array.isArray(body)) return json({code:'INVALID_JSON'},400,cors||{});
          const response=await prismService.handle(url.pathname.split('/').pop(),body);
          return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...(cors||{})}});
        } catch(error) {return json({code:clean(error?.message||'PRISM_RETURN_FAILED')},Number(error?.status)||503,cors||{});}
      }

      if (url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/pull`) {
        const result = await sessions.pull(auth);
        return result?.ok ? json({ commands:result.commands || [] }, 200, cors || {}) : json({ code:result?.code || "HUB_UNAVAILABLE" }, statusFor(result?.code), cors || {});
      }

      if (url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/receipts`) {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code:"INVALID_JSON" }, 400, cors || {});
        const result = await sessions.pushReceipts({ ...auth, receipts:body.receipts });
        return result?.ok ? json({ accepted:result.accepted || 0 }, 200, cors || {}) : json({ code:result?.code || "HUB_UNAVAILABLE" }, statusFor(result?.code), cors || {});
      }

      if (url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/state`) {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code:"INVALID_JSON" }, 400, cors || {});
        const result = await sessions.pushState({ ...auth, packet:body });
        return result?.ok ? json({ ok:true }, 200, cors || {}) : json({ code:result?.code || "HUB_UNAVAILABLE" }, statusFor(result?.code), cors || {});
      }

      if (url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/board`) {
        const result = await sessions.board(auth);
        return result?.ok ? json({ board:result.board || null }, 200, cors || {}) : json({ code:result?.code || "HUB_UNAVAILABLE" }, statusFor(result?.code), cors || {});
      }

      if (url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/session/stop`) {
        const result = await sessions.stop(auth);
        return result?.ok ? json({ ok:true }, 200, cors || {}) : json({ code:result?.code || "HUB_UNAVAILABLE" }, statusFor(result?.code), cors || {});
      }

      return json({ code:"NOT_FOUND" }, 404, cors || {});
    },
  });
}

export function createLighthouseControlPortMcpService({ namespace } = {}) {
  function sessions() { return stub(namespace); }
  function requireTarget(value) {
    if (clean(value).toLowerCase() !== "lighthouse") throw Object.assign(new Error("WORK_TARGET_REQUIRED"), { status:400 });
  }
  return Object.freeze({
    async boardRead() {
      const current = sessions();
      if (!current || typeof current.latestBoard !== "function") return json({ code:"HUB_UNAVAILABLE" }, 503);
      const result = await current.latestBoard();
      if (!result?.ok) return json({ code:result?.code || "HUB_UNAVAILABLE" }, statusFor(result?.code));
      const board = result.board && typeof result.board === "object" ? result.board : {};
      const revision = Number(board.revision);
      return json({
        ok:true,
        boardId:clean(board.boardId) || null,
        revision:Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
        pins:Array.isArray(board.pins) ? board.pins : [],
        updatedAt:board.updatedAt == null ? null : clean(board.updatedAt),
      }, 200);
    },

    async state({ targetId } = {}) {
      requireTarget(targetId);
      const current = sessions();
      if (!current || typeof current.latest !== "function") return json({ code:"HUB_UNAVAILABLE" }, 503);
      const result = await current.latest();
      return result?.ok ? json(result, 200) : json({ code:result?.code || "HUB_UNAVAILABLE", session:result?.session || null }, statusFor(result?.code));
    },
    async projectCentre(view = {}) {
      const current = sessions();
      if (!current || typeof current.projectCentre !== "function") return json({ code:"HUB_UNAVAILABLE" }, 503);
      const result = await current.projectCentre(view);
      return result?.ok ? json(result, 200) : json({ code:result?.code || "HUB_UNAVAILABLE" }, statusFor(result?.code));
    },
    async command({ targetId, requestId, capabilityId, payload = {} } = {}) {
      requireTarget(targetId);
      const current = sessions();
      if (!current || typeof current.enqueue !== "function") return json({ code:"HUB_UNAVAILABLE" }, 503);
      const result = await current.enqueue({ requestId, capabilityId, payload });
      return result?.ok ? json(result, 200) : json({ code:result?.code || "HUB_UNAVAILABLE" }, statusFor(result?.code));
    },
  });
}
