import { isCurrentAgentMissionTool } from "./go-hub-control-room.js";

export const AGENT_MISSION_ACTIONS = Object.freeze([
  "arrive",
  "find",
  "enter",
  "create",
  "issue_card",
  "prepare_route_change",
  "confirm_route_change",
  "select_context",
  "note",
  "ask_light",
  "first_open",
  "touch",
  "return",
  "update_card",
  "exit",
  "inspect",
]);


const text = value => String(value ?? "").trim();
const clone = value => value == null ? value : structuredClone(value);

export function resolveCurrentAgentMissionEntry(tools = []) {
  const current = (Array.isArray(tools) ? tools : []).find(isCurrentAgentMissionTool);
  if (!isCurrentAgentMissionTool(current)) {
    return Object.freeze({ status:"UNKNOWN", reason:"CURRENT_AGENT_MISSION_ENTRY_NOT_EXPOSED", entry:null });
  }
  return Object.freeze({
    status:"CURRENT",
    reason:"CURRENT_EXPOSED_CONTRACT_VERIFIED",
    entry:Object.freeze({
      tool:current.name,
      description:text(current.description) || null,
      inputSchema:clone(current.inputSchema),
      annotations:clone(current.annotations || {}),
    }),
  });
}

export function createAionGate({ queryControlRoom, now = () => new Date().toISOString() } = {}) {
  if (typeof queryControlRoom !== "function") throw new Error("AION_CONTROL_ROOM_QUERY_REQUIRED");

  return Object.freeze({
    async open(input = {}) {
      // Deliberately query CURRENT on every invocation. AION owns no cache and has no stale fallback.
      let current;
      try {
        current = await queryControlRoom();
      } catch {
        current = null;
      }
      const verified = current?.status === "CURRENT" && current?.source === "GO_CONTROL_ROOM_CURRENT_MCP_LIST";
      const tools = verified && Array.isArray(current?.tools) ? current.tools : [];
      const resolved = resolveCurrentAgentMissionEntry(tools);
      const observedAt = verified ? current.observedAt : now();
      if (resolved.status !== "CURRENT") {
        return Object.freeze({
          ok:false,
          gate:"AION",
          action:"OPEN",
          status:"UNKNOWN",
          reason:resolved.reason,
          transfer:null,
          closed:true,
          observedAt,
          cacheUsed:false,
          authorityCreated:false,
          workCreated:false,
          routeSelected:false,
        });
      }
      const capabilities = tools.map(tool => Object.freeze({
        name:text(tool?.name),
        description:text(tool?.description) || null,
        readOnly:tool?.annotations?.readOnlyHint === true,
        destructive:tool?.annotations?.destructiveHint === true,
      })).filter(item => item.name);
      return Object.freeze({
        ok:true,
        gate:"AION",
        action:"OPEN",
        status:"CURRENT",
        source:current.source,
        observedAt,
        broadcast:clone(current?.broadcast || null),
        contract:resolved.entry,
        capabilities:Object.freeze(capabilities),
        transfer:Object.freeze({
          tool:resolved.entry.tool,
          context:clone(input?.context || {}),
        }),
        closed:true,
        cacheUsed:false,
        authorityCreated:false,
        workCreated:false,
        routeSelected:false,
      });
    },
  });
}
