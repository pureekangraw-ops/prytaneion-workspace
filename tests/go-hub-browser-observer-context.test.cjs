"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const moduleUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-browser-observer-session.js")).href;
class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key); }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
  async delete(key) { this.map.delete(key); }
}
function packet() {
  return { schema_version:"go-browser-observer-v1", session_id:"session-1", captured_at:new Date(2000).toISOString(), origin:"https://gumroad.com", sanitized_path:"/products/demo", page_title:"Edit product", viewport:{width:390,height:844}, page_fingerprint:"obsfp:abc12345", visible_landmarks:[], visible_text_snippets:[], interactive_elements:[], fields:[], redaction_report:{sensitive_blocked:0,unknown_redacted:0,hidden_omitted:0}, optional_screenshot_ref:null };
}
test("observer latest refuses unbound or mismatched Work context", async () => {
  const m = await import(moduleUrl + "?context=" + Date.now());
  const service = m.createObserverSessionService({ storage:new MemoryStorage(), now:() => 2500, randomUUID:() => "session-1", randomToken:() => "token-1" });
  await service.start({ allowedOrigin:"https://gumroad.com", workContext:{ workId:"WORK-1", checkpointId:"CP-1" } });
  assert.equal((await service.acceptSnapshot({ sessionId:"session-1", sessionToken:"token-1", packet:packet() })).ok, true);
  assert.deepEqual(await service.latest(), { ok:false, code:"WORK_CONTEXT_REQUIRED" });
  assert.deepEqual(await service.latest({ workContext:{ workId:"WORK-2", checkpointId:"CP-1" } }), { ok:false, code:"WORK_CONTEXT_MISMATCH" });
  assert.equal((await service.latest({ workContext:{ workId:"WORK-1", checkpointId:"CP-1" } })).ok, true);
});
