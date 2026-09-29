import { isCurrentAgentMissionTool, AGENT_MISSION_ACTIONS } from "./go-hub-agent-mission-contract.mjs";

export { AGENT_MISSION_ACTIONS };

const text = value => String(value ?? "").trim();
const clone = value => value == null ? value : structuredClone(value);

export function resolveCurrentAgentMissionEntry(tools = []) {
  const current = (Array.isArray(tools) ? tools : []).find(isCurrentAgentMissionTool);
  if (!isCurrentAgentMissionTool(current)) {
    return Object.freeze({ status:"UNKNOWN", reason:"CURRENT_AGENT_MISSION_ROUTE_UNAVAILABLE", entry:null });
  }
  return Object.freeze({
    status:"CURRENT",
    reason:"CURRENT_AGENT_MISSION_ROUTE_IDENTIFIED",
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
      // AION is a pointer, not an entry gate. It observes CURRENT and never executes HERMES.
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
      const context = clone(input?.context || {});
      const capabilities = tools.map(tool => Object.freeze({
        name:text(tool?.name),
        description:text(tool?.description) || null,
        readOnly:tool?.annotations?.readOnlyHint === true,
        destructive:tool?.annotations?.destructiveHint === true,
      })).filter(item => item.name);

      return Object.freeze({
        ok:true,
        surface:"AION_ROUTE",
        action:"ROUTE",
        status:resolved.status,
        source:verified ? current.source : null,
        reason:resolved.reason,
        observedAt,
        broadcast:clone(current?.broadcast || null),
        contract:resolved.entry,
        capabilities:Object.freeze(capabilities),
        route:resolved.entry ? Object.freeze({
          tool:resolved.entry.tool,
          mode:"POINTER_ONLY",
          context,
        }) : null,
        handoff:null,
        executed:false,
        closed:true,
        cacheUsed:false,
        authorityCreated:false,
        workCreated:false,
        sessionCreated:false,
        routeSelected:false,
      });
    },
  });
}
