import { createAgentPersonaRoom } from "./go-hub-agent-persona-room.mjs";
import { createAgentLensRoom } from "./go-hub-agent-lens-room.mjs";

const text = value => String(value ?? "").trim();

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers:{ "content-type":"application/json; charset=utf-8" } });
}

async function body(response) {
  return response instanceof Response ? response.clone().json().catch(() => ({})) : response || {};
}

export function createAgentFittingRoom(options = {}) {
  const personaRoom = createAgentPersonaRoom();
  const lensRoom = createAgentLensRoom(options);
  return Object.freeze({
    async action(input = {}) {
      const action = text(input.action).toLowerCase();
      if (action === "list") {
        const [personaResponse, lensResponse] = await Promise.all([
          personaRoom.action({ action:"list" }),
          lensRoom.action({ action:"list", workContext:input.workContext }),
        ]);
        return json({
          ok:true,
          room:"AGENT_FITTING_ROOM",
          optional:true,
          personas:(await body(personaResponse)).personas || [],
          lenses:(await body(lensResponse)).lenses || [],
          authorityCreated:false,
          routeChanged:false,
          workChanged:false,
        });
      }
      if (action !== "fit") return json({ code:"FITTING_ROOM_ACTION_REQUIRED" }, 400);
      if (!text(input.personaId) || !text(input.lensId)) return json({ code:"FITTING_ROOM_PERSONA_AND_LENS_REQUIRED" }, 400);

      const personaResponse = await personaRoom.action({ action:"equip", agentId:input.agentId, personaId:input.personaId });
      if (!personaResponse.ok) return personaResponse;
      const lensResponse = await lensRoom.action({
        action:"select",
        agentId:input.agentId,
        lensId:input.lensId,
        tabletId:input.tabletId,
        accessScope:input.accessScope,
        workContext:input.workContext,
      });
      if (!lensResponse.ok) return lensResponse;

      return json({
        ok:true,
        room:"AGENT_FITTING_ROOM",
        persona:(await body(personaResponse)).persona || null,
        lens:(await body(lensResponse)).lens || null,
        tabletId:input.tabletId || null,
        workContext:input.workContext || null,
        confirmation:"FITTING_ACTIVE",
        exited:true,
        authorityCreated:false,
        routeChanged:false,
        workChanged:false,
        passOpened:false,
        toolAccessChanged:false,
      });
    },
  });
}
