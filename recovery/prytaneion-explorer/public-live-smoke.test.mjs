import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BASE = "https://prytaneion-explorer.pureekangraw.workers.dev";
test("retired provider has no public workers.dev or preview entrance", () => {
  const config = JSON.parse(readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.services, []);
});
test("LIVE retired public routes cannot serve the old provider", async () => {
  for (const path of ["/", "/health", "/hub-mcp/cloudflare"]) {
    const response = await fetch(BASE + path, {
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(12000)
    });
    await response.body?.cancel();
    assert.ok(response.status >= 400 && response.status < 600,
      "retired route unexpectedly reachable: " + path + " HTTP " + response.status);
  }
});
