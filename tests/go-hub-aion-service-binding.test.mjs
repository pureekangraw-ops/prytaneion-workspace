import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("GO Hub binds OLYMPUS internally and keeps yggmetro fallback",()=>{
  const wrangler=fs.readFileSync(new URL("../wrangler.go-hub.jsonc", import.meta.url),"utf8");
  assert.match(wrangler,/"binding"\s*:\s*"OLYMPUS_SERVICE"/);
  assert.match(wrangler,/"service"\s*:\s*"olympus"/);

  const worker=fs.readFileSync(new URL("../go-hub-factory-mcp-worker.mjs", import.meta.url),"utf8");
  assert.match(worker,/env\?\.OLYMPUS_SERVICE\?\.fetch/);
  assert.match(worker,/env\.OLYMPUS_SERVICE\.fetch/);
  assert.match(worker,/https:\/\/olympus\.yggmetro\.com/);

  const adapter=fs.readFileSync(new URL("../go-hub-aion-olympus-adapter.mjs", import.meta.url),"utf8");
  assert.match(adapter,/endpoint = "https:\/\/olympus\.yggmetro\.com"/);
});
