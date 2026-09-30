export const AGENT_MISSION_ACTIONS = Object.freeze([
  "pickup_card",
  "help_choose",
  "apply_selection",
  "return_card",
]);

export const LEGACY_AGENT_MISSION_ACTIONS = Object.freeze([
  "find",
  "enter",
  "reopen",
  "manual_continue",
  "emergency_enter",
  "emergency_exit",
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

export function isCurrentAgentMissionTool(tool) {
  const actions = tool?.inputSchema?.properties?.action?.enum;
  return tool?.name === "go_hub_agent_mission" &&
    tool?.inputSchema?.type === "object" &&
    Array.isArray(actions) &&
    tool.inputSchema.required?.includes("action") &&
    AGENT_MISSION_ACTIONS.every(action => actions.includes(action));
}
