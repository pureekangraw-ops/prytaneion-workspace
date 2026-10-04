const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("PIXIE Visual Workbench wires the UI Design Lane projection", () => {
  const html = read("pixie-visual-workbench.html");
  const js = read("pixie-visual-workbench.js");
  assert.match(html, /data-ui-design-lane/);
  assert.match(html, /data-ui-design-canvas/);
  assert.match(html, /data-ui-design-export-json/);
  assert.match(html, /data-ui-design-preview-action/);
  assert.match(html, /data-ui-design-readback-action/);
  assert.match(js, /mountUiDesignLane/);
  assert.match(js, /go-hub-ui-design-lane\.js/);
});

test("UI Design Lane assets are present and keep the model as the command owner", () => {
  const module = read("go-hub-ui-design-lane.js");
  assert.match(module, /createUiDesignDocument/);
  assert.match(module, /updateNode/);
  assert.match(module, /createDesignVersion/);
  assert.match(module, /approveDesignVersion/);
  assert.match(module, /createDesignHandoffPacket/);
  assert.match(module, /createPixiePreviewRequest/);
  assert.match(module, /createReadbackReport/);
  assert.ok(fs.existsSync(path.join(root, "go-hub-ui-design-lane-model.mjs")));
  assert.ok(fs.existsSync(path.join(root, "go-hub-ui-design-lane.css")));
});
