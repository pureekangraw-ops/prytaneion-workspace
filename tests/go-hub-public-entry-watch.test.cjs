"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.join(__dirname, "..", ".github", "workflows", "go-hub-public-entry-watch.yml");

test("GO Hub public-entry watch probes the user surface and performs one bounded recovery deploy", () => {
  const source = fs.readFileSync(workflowPath, "utf8");

  assert.match(source, /schedule:\s*[\s\S]*cron:\s*"\*\/10 \* \* \* \*"/);
  assert.match(source, /https:\/\/go-hub\.\$\{subdomain\}\.workers\.dev/);
  assert.match(source, /<title>GO Hub<\/title>/);
  assert.match(source, /grep -Fq "CENTRE"/);
  assert.match(source, /steps\.probe\.outcome == 'failure'/);
  assert.match(source, /npx wrangler deploy --config wrangler\.go-hub\.jsonc/);
  assert.match(source, /exact current main once/);
  assert.match(source, /still unavailable after one controlled redeploy/);
});
