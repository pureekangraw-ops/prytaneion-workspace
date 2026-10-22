import { CITY_DESTINATIONS, getCityDestination } from "../../go-hub-route-contract.js";
import { authorityMap, authorityOwner, assertUniqueDecisionAuthority } from "../../go-hub-authority-map.js";

// Isolated, read-only doorway to original GO Hub modules. It does not run the
// former GO Hub, consume WorkHub tasks, or accept arbitrary RPC operations.
const STATUS = "UNDER_MAINTENANCE";
const SOURCE = "pureekangraw-ops/prytaneion-workspace";
const HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "access-control-allow-origin": "null"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...HEADERS, "content-type": "application/json; charset=utf-8" }
  });
}

function maintenancePage() {
  const html = [
    "<!doctype html><html lang='th'><head><meta charset='utf-8'>",
    "<meta name='viewport' content='width=device-width, initial-scale=1'>",
    "<title>PRYTANEION — Under Maintenance</title>",
    "<style>body{background:#101822;color:#ecf3fc;font:16px/1.65 system-ui,sans-serif;margin:0}",
    "main{max-width:750px;margin:9vh auto;padding:28px}",
    "h1{font-size:clamp(2rem,6vw,4rem);line-height:1.1;margin:.4em 0}",
    ".label{font-size:.78rem;letter-spacing:.14em;color:#b5ccdc}",
    ".box{border:1px solid #415163;border-radius:15px;padding:20px;margin-top:26px;background:#172330}",
    "a{color:#9fe0e1}small{color:#b5ccdc}</style></head><body><main>",
    "<span class='label'>GO HUB / PRYTANEION • RECOVERY ENTRANCE</span>",
    "<h1>UNDER MAINTENANCE</h1>",
    "<p>พื้นที่เก่ากำลังเปิดให้สำรวจแบบอ่านอย่างเดียว ยังไม่เปิดรับงานหรือสั่งเครื่องจักร</p>",
    "<div class='box'><strong>ทางเดินสำรวจ</strong><p>",
    "<a href='/api/explore'>Legacy route map (source-backed)</a> · ",
    "<a href='/api/bridge-health'>PANTHEON binding check</a> · ",
    "<a href='/health'>Entrance health</a></p>",
    "<small>No task dispatch, edits, secret export, or production routing.</small></div>",
    "<p><small>Legacy source: <a href='https://github.com/pureekangraw-ops/prytaneion-workspace'>GitHub repository</a></small></p>",
    "</main></body></html>"
  ].join("");
  return new Response(html, {
    headers: {
      ...HEADERS,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
    }
  });
}

export function exploreLegacy() {
  const unique = assertUniqueDecisionAuthority();
  const areas = authorityMap();
  return {
    system: "PRYTANEION",
    status: STATUS,
    mode: "READ_ONLY_EXPLORATION",
    legacySource: SOURCE,
    legacyRuntimeFullyRestored: false,
    sourceBacked: true,
    destinations: Object.values(CITY_DESTINATIONS).map(function (d) {
      return { id: d.id, route: d.route, role: d.role, live: false };
    }),
    sample: {
      githubDestination: getCityDestination("destination://github")?.id || null,
      workIdentityOwner: authorityOwner("WORK_IDENTITY")
    },
    authorityCount: Object.keys(areas).length,
    uniqueAuthorityCount: Object.keys(unique).length,
    taskExecutionEnabled: false
  };
}

export async function probePantheon(env) {
  if (!env?.PANTHEON_OWNER || typeof env.PANTHEON_OWNER.ownerCall !== "function") {
    return { status: "NOT_CONNECTED", connected: false, credentialSource: "PANTHEON_ONLY" };
  }
  try {
    // Fixed, read-only RPC. Never accept an operation or arbitrary arguments
    // from the public request. Secrets remain exclusively in PANTHEON.
    const r = await env.PANTHEON_OWNER.ownerCall({ operation: "factory_health" });
    const live = r?.ok === true && r?.upstream_status === 200
      && r?.result?.factory?.connection === "CONNECTED";
    return {
      status: live ? "CONNECTED" : "UNVERIFIED",
      connected: live,
      credentialSource: "PANTHEON_ONLY"
    };
  } catch {
    return { status: "UNAVAILABLE", connected: false, credentialSource: "PANTHEON_ONLY" };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET") return json({ code: "READ_ONLY_MAINTENANCE" }, 405);
    if (url.pathname === "/") return maintenancePage();
    if (url.pathname === "/health") {
      return json({ system: "PRYTANEION_EXPLORER", status: STATUS, readOnly: true });
    }
    if (url.pathname === "/api/explore") return json(exploreLegacy());
    if (url.pathname === "/api/bridge-health") {
      return json({ system: "PRYTANEION_EXPLORER", status: STATUS, ...(await probePantheon(env)) });
    }
    return json({ code: "NOT_FOUND" }, 404);
  }
};
