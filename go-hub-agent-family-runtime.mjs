import {
  AGENT_FAMILY_VERSION,
  AGENT_FAMILY_POLICY,
  AGENT_ROLES,
  agentRuntimeDescriptor,
  createAgentWorkEnvelope,
  createVerifiedReturn,
} from "./go-hub-agent-family.mjs";
import { adaptActorAction } from "./go-hub-universal-work-protocol.mjs";

export const AGENT_HOME_ROUTES = Object.freeze({
  PIXIE:Object.freeze({
    receive:"COUNTER",
    home:"PIXIE_LAB_GO_WORKS",
    entryTools:Object.freeze(["go_hub_pixie_command","go_hub_pixie_go_works_action"]),
    resultTools:Object.freeze(["go_hub_pixie_result"]),
  }),
  SPECTRUM:Object.freeze({
    receive:"COUNTER",
    home:"WEB_OFFICE_STOREFRONT",
    entryTools:Object.freeze(["CENTRE_SPECTRUM_INTAKE","OFFICE_WEB_SURFACE"]),
    resultTools:Object.freeze(["OFFICE_STATUS_BRIEF"]),
  }),
  HERMES:Object.freeze({
    receive:"COUNTER",
    home:"CENTRE_TRANSPORT_STATION",
    entryTools:Object.freeze(["go_hub_agent_mission"]),
    resultTools:Object.freeze(["go_hub_agent_mission:return_tablet"]),
  }),
  MIMIR:Object.freeze({
    receive:"CENTRE_RETURN",
    home:"CENTRE_HOUSEKEEPING",
    entryTools:Object.freeze(["planReturnHousekeeping"]),
    resultTools:Object.freeze(["HOUSEKEEPING_REPORT"]),
  }),
  LIGHT:Object.freeze({
    receive:"COUNTER",
    home:"NOTION_KNOWLEDGE_RUNTIME",
    entryTools:Object.freeze(["go_hub_counter_inbox","go_hub_notion_call"]),
    resultTools:Object.freeze(["go_hub_counter_answer","KNOWLEDGE_BRIEF"]),
  }),
});

function required(value,label){
  const out=String(value??"").trim();
  if(!out) throw new Error(label+" is required");
  return out;
}

const RECEIVE_ACTIONS = Object.freeze({
  PIXIE:"receive",
  SPECTRUM:"intake",
  HERMES:"pickup_tablet",
  MIMIR:"receive",
  LIGHT:"claim",
});

export function translateAgentAction({ agentId, action, sourceEvent = action } = {}) {
  return adaptActorAction({ actor:agentId, action, sourceEvent });
}

function translateAgentReceive(agentId, sourceEvent) {
  const action=RECEIVE_ACTIONS[agentId];
  if(!action) throw new Error("AGENT_RECEIVE_ACTION_UNKNOWN:"+agentId);
  return translateAgentAction({ agentId, action, sourceEvent });
}

export function getAgentHomeRoute(agentId){
  const id=required(agentId,"agentId").toUpperCase();
  const route=AGENT_HOME_ROUTES[id];
  if(!route) throw new Error("AGENT_HOME_ROUTE_UNKNOWN:"+id);
  return Object.freeze({
    agent:agentRuntimeDescriptor(id),
    ...route,
  });
}

export function prepareAgentDispatch(input={}){
  const agentId=required(input.agentId,"agentId").toUpperCase();
  const route=getAgentHomeRoute(agentId);
  const envelope=createAgentWorkEnvelope({
    agentId,
    workId:input.workId,
    checkpointId:input.checkpointId,
    requestedResult:input.requestedResult,
    ownerSource:input.ownerSource||"CENTRE",
    acceptanceCriteria:input.acceptanceCriteria||[],
    nextAction:input.nextAction||"ENTER_HOME_RUNTIME",
    state:"RECEIVE",
  });
  const lifecycle=translateAgentReceive(agentId, input.sourceEvent || agentId+"_DISPATCH");
  return Object.freeze({
    contract:AGENT_FAMILY_VERSION,
    envelope,
    handoff:Object.freeze({
      from:route.receive,
      to:route.home,
      entryTools:route.entryTools,
      authorityExpanded:false,
      workTruthOwner:AGENT_FAMILY_POLICY.workTruthOwner,
      checkpointPreserved:true,
      lifecycle:Object.freeze({
        event:lifecycle.event,
        actorAction:lifecycle.actorAction,
        sourceEvent:lifecycle.sourceEvent,
        adapter:lifecycle.adapter,
      }),
    }),
  });
}

export function prepareAgentReturn(input={}){
  const returned=createVerifiedReturn(input);
  const route=getAgentHomeRoute(returned.agentId);
  const actorAction=input.actorAction || (returned.agentId === "HERMES" ? "return_tablet" : "return");
  const lifecycle=translateAgentAction({
    agentId:returned.agentId,
    action:actorAction,
    sourceEvent:input.sourceEvent || actorAction,
  });
  return Object.freeze({
    contract:AGENT_FAMILY_VERSION,
    from:route.home,
    to:"CENTRE",
    returned,
    resultTools:route.resultTools,
    authorityExpanded:false,
    checkpointPreserved:true,
    lifecycle:Object.freeze({
      event:lifecycle.event,
      actorAction:lifecycle.actorAction,
      sourceEvent:lifecycle.sourceEvent,
      adapter:lifecycle.adapter,
      nextEvent:lifecycle.event === "RETURN" ? "VERIFY" : null,
      workStatus:returned.agentId === "PIXIE" && returned.status === "COMPLETE"
        ? "WAIT_VERIFY"
        : null,
      closeAllowed:false,
    }),
  });
}

export function agentFamilyOverview(){
  return Object.freeze({
    contract:AGENT_FAMILY_VERSION,
    policy:AGENT_FAMILY_POLICY,
    agents:Object.freeze(
      Object.keys(AGENT_ROLES).map(id=>Object.freeze({
        ...agentRuntimeDescriptor(id),
        route:getAgentHomeRoute(id),
      }))
    ),
  });
}


export function agentFamilyStatus(input={}) {
  const action=String(input.action||"overview").trim().toLowerCase();
  if(action==="overview") return agentFamilyOverview();
  if(action==="route") return getAgentHomeRoute(input.agentId);
  throw new Error("AGENT_FAMILY_ACTION_INVALID:"+action);
}
