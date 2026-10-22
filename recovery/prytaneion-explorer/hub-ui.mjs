// Maintenance lobby. No privileged output is included in the public page.
export function renderHubPage() {
const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>PRYTANEION — GO Hub Walkthrough</title>
<style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#e8f1f7;background:#09131e}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at top right,#1c3943 0,#09131e 55%);min-height:100vh}
main{width:min(1100px,100% - 34px);margin:0 auto;padding:32px 0 60px}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.brand{font-size:13px;letter-spacing:.12em;font-weight:700;color:#a6cdca}
.badge{color:#ffd890;border:1px solid #8e6c35;background:#34291e;font-size:11px;font-weight:700;padding:5px 10px;border-radius:100px}
h1{font-size:clamp(2.2rem,6vw,4.2rem);letter-spacing:-.055em;margin:25px 0 8px;line-height:1.04}
.subtitle{font-size:16px;color:#b0bdc9;max-width:780px}
.pills{display:flex;gap:10px;flex-wrap:wrap;margin:25px 0}
.pill{border:1px solid #365466;border-radius:8px;padding:8px 12px;background:#102533;color:#b9dadd;font-size:12px}
section{border:1px solid #334c5c;border-radius:18px;background:#10212f;padding:22px;margin-top:18px}
h2{font-size:19px;margin:0 0 10px}
.desc{color:#aec2cf;font-size:13px;margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.slot{background:#172e3c;border-radius:12px;padding:13px;border:1px solid #2b4b59}
.slot strong{display:block;margin-bottom:6px}
.state{font-size:12px;color:#a9c2cc}
.controls{display:flex;gap:8px;flex-wrap:wrap}
button{border:1px solid #52717d;border-radius:9px;background:#173847;color:#dce9f0;padding:9px 13px;cursor:pointer}
button:hover,button:focus-visible{background:#266071}
button:disabled{opacity:.6;cursor:not-allowed}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.6;max-height:60vh;overflow:auto;border-radius:12px;border:1px solid #234555;background:#07131d;padding:18px;color:#bfdee6}
a{color:#8ee4d4}small{color:#9eafbb}
footer{padding:30px 0;color:#9badb7;font-size:12px}
</style></head>
<body><main>
<header><span class="brand">GO HUB · PRYTANEION WORKSPACE</span><span class="badge">UNDER MAINTENANCE</span></header>
<h1>Walking entrance<br>to the old Hub.</h1>
<p class="subtitle">เปิดทางเดินสำรวจของจริง อ่าน Source จาก GitHub และตรวจสถานะ Service Binding ไปยัง PANTHEON ปัจจุบัน — ไม่มีการส่งงานหรือแก้ไข Production</p>
<div class="pills"><span class="pill">READ ONLY</span><span class="pill">PANTHEON SERVICE BINDING</span><span class="pill">LEGACY MODULES</span></div>
<section><h2>สายไฟที่ต่ออยู่</h2>
<p class="desc">ตรวจจริงเมื่อกดปุ่ม โดยไม่แสดงข้อมูลส่วนตัวหรือ Secret</p>
<div class="grid">
<div class="slot"><strong>GitHub</strong><span class="state" id="github-state">ยังไม่ได้ทดสอบ</span></div>
<div class="slot"><strong>Google Drive</strong><span class="state" id="google-state">ยังไม่ได้ทดสอบ</span></div>
<div class="slot"><strong>PANTHEON</strong><span class="state" id="pantheon-state">ยังไม่ได้ทดสอบ</span></div>
<div class="slot"><strong>Notion REST</strong><span class="state" id="notion-state">กำลังทดสอบ LIGHT Notion API</span></div>
<div class="slot"><strong>Cloudflare</strong><span class="state" id="cloudflare-state">กำลังทดสอบ LIGHT Cloudflare Reader</span></div>
</div><p><button id="probe" type="button">ตรวจสายไฟจริง</button></p></section>
<section><h2>เดินสำรวจ Source ของฮับเก่า</h2>
<p class="desc">ใช้งาน GitHub REST จริง เฉพาะไฟล์สาธารณะใน PRYTANEION · ข้อมูลจาก Repository ไม่ได้คัดลอกมาแสดงล่วงหน้า</p>
<div class="controls">
<button type="button" data-file="go-hub-github-workspace.js">GitHub Workspace</button>
<button type="button" data-file="go-hub-google-drive-service.mjs">Google Drive</button>
<button type="button" data-file="go-hub-notion-light.mjs">Notion AI Search</button>
<button type="button" data-file="go-hub-cloudflare-service.mjs">Cloudflare</button>
<button type="button" data-file="go-hub.html">Original Hub UI</button>
<button type="button" data-file="go-hub-authority-map.js">Authority Map</button>
</div>
<p id="read-state" class="desc" role="status">เลือกเครื่องมือเพื่ออ่าน Source จาก GitHub</p>
<pre id="source" aria-label="GitHub live source">No file loaded</pre>
</section>
<section><h2>ขอบเขตซ่อมบำรุง</h2>
<p class="desc">Notion AI Ask/Search เดิมยังไม่เชื่อม OAuth กลับมา (Notion REST ใช้แทนไม่ได้) · Google/Cloudflare แสดงเฉพาะสถานะ ไม่เผยข้อมูลส่วนตัว · Factory ไม่รับงานจากหน้านี้</p>
<a href="https://github.com/pureekangraw-ops/prytaneion-workspace" rel="noopener noreferrer" target="_blank">ดู Source ต้นฉบับบน GitHub ↗</a>
</section>
<footer>GO Hub recovery • no work dispatch • no secret copying • no new gate maze</footer>
<script src="/ui.js" defer></script></main></body></html>`;
return new Response(html, { status:200, headers:{
"content-type":"text/html; charset=utf-8","cache-control":"no-store",
"x-frame-options":"DENY","x-content-type-options":"nosniff",
"content-security-policy":"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
}});
}
export function renderUiScript() {
const code = `
'use strict';
const byId=id=>document.getElementById(id);
function setState(id,v){const x=byId(id);if(x)x.textContent=v;}
async function loadConnections(){
  const b=byId('probe');b.disabled=true;b.textContent='กำลังตรวจระบบจริง...';
  try{
    const r=await fetch('/api/connections?refresh=1',{cache:'no-store'});
    const data=await r.json();
    const s=data.connections||{};
    for(const k of ['github','google','pantheon','notion','cloudflare']){
      const x=s[k];setState(k+'-state',typeof x==='string'?x:(x?.status||'UNKNOWN'));
    }
  }catch{for(const k of ['github','google','pantheon'])setState(k+'-state','UNAVAILABLE');}
  finally{b.disabled=false;b.textContent='ตรวจสายไฟอีกครั้ง';}
}
async function readFile(name){
 setState('read-state','กำลังอ่าน '+name+' จาก GitHub...');
 byId('source').textContent='Loading...';
 try{
 const p=new URLSearchParams({repository:'pureekangraw-ops/prytaneion-workspace',path:name});
 const r=await fetch('/hub/api/github-workspace/file?'+p.toString(),{cache:'no-store'});
 const d=await r.json();
 if(!r.ok)throw Error(d.code||'HTTP_'+r.status);
 byId('source').textContent=d.content;
 setState('read-state',name+' • live GitHub source • SHA '+(d.sha||'unknown'));
 }catch(e){byId('source').textContent='Unable to load';setState('read-state',String(e.message||e));}
}
byId('probe').addEventListener('click',loadConnections);
document.querySelectorAll('[data-file]').forEach(b=>b.addEventListener('click',()=>readFile(b.dataset.file)));
loadConnections();
`;
return new Response(code,{headers:{"content-type":"application/javascript; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
}
