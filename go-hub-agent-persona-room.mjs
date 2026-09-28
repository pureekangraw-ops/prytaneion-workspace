const text = value => String(value ?? "").trim();

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{ "content-type":"application/json; charset=utf-8" },
  });
}

export function createAgentPersonaRoom() {
  return Object.freeze({
    async action(input = {}) {
      const action = text(input.action).toLowerCase();
      if (action !== "equip") return json({ code:"PERSONA_ROOM_EXPLICIT_EQUIP_REQUIRED" }, 400);

      const agentId = text(input.agentId);
      const personaId = text(input.personaId);
      const personaReference = text(input.personaReference);
      if (!agentId) return json({ code:"PERSONA_ROOM_AGENT_REQUIRED" }, 400);
      if (!personaId && !personaReference) return json({ code:"PERSONA_ROOM_PERSONA_REQUIRED" }, 400);

      return json({
        ok:true,
        room:"AGENT_PERSONA_ROOM",
        entryMode:"OWNER_EXPLICIT_ONLY",
        autoEntry:false,
        agentId,
        persona:{
          personaId:personaId || null,
          personaReference:personaReference || null,
          state:"ACTIVE",
        },
        confirmation:"PERSONA_ACTIVE",
        exited:true,
        authorityCreated:false,
        routeChanged:false,
        workChanged:false,
      });
    },
  });
}
