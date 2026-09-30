const text = value => String(value ?? "").trim();
const clone = value => value == null ? value : structuredClone(value);

export const LENS_SOURCE = Object.freeze({
  type:"USER_ATTACHED_SPEC",
  lensSet:"GO — NEW LENS SET",
  personaSurvivors:"GO — PERSONA SURVIVORS",
  verificationState:"USER_PROVIDED_SOURCE",
});

export const LENSES = Object.freeze({
  "LENS-EVIDENCE": Object.freeze({
    name:"EVIDENCE",
    kind:"VIEWPOINT",
    focus:"What evidence supports the claim, where the gaps are, and FACT / INFERENCE / UNKNOWN separation.",
    question:"What do we know this from, and how far is that evidence entitled to speak?",
  }),
  "LENS-CURRENT": Object.freeze({
    name:"CURRENT",
    kind:"VIEWPOINT",
    focus:"Freshness, recent change, pending work, deadlines, current-vs-stale state, and residue.",
    question:"Is this still true now, what changed, and what old residue is misleading Current?",
  }),
  "LENS-SYSTEM": Object.freeze({
    name:"SYSTEM",
    kind:"VIEWPOINT",
    focus:"Components, locations, connections, dependencies, collisions, scope, and end-to-end continuity.",
    question:"Where is this, what does it connect to, and what is affected if it changes?",
  }),
  "LENS-ESSENCE": Object.freeze({
    name:"ESSENCE",
    kind:"VIEWPOINT",
    focus:"Real function, meaning, intent, shared core, and differences that must not be flattened.",
    question:"After removing the shell, what is this really?",
  }),
  "LENS-FRICTION": Object.freeze({
    name:"FRICTION",
    kind:"VIEWPOINT",
    focus:"Duplication, clutter, bottlenecks, misplaced responsibility, friction, and misleading residue.",
    question:"What is making the system heavy, cluttered, stiff, or look Current when it is not?",
  }),
  "LENS-FORM": Object.freeze({
    name:"FORM",
    kind:"VIEWPOINT",
    focus:"Whether the existing structure, flow, and experience serve or obstruct the intent.",
    question:"Does the shape of this flow serve its actual purpose?",
  }),
  "LENS-CONSEQUENCE": Object.freeze({
    name:"CONSEQUENCE",
    kind:"VIEWPOINT",
    focus:"Variables, assumptions, constraints, capabilities, trade-offs, and downstream effects of change.",
    question:"If we choose or change this, what follows, and what are we trading away?",
  }),
  "LENS-ACTION": Object.freeze({
    name:"ACTION",
    kind:"VIEWPOINT",
    focus:"The type of transformation needed from current Reality toward the Requested Result, without doing the work of a Skill.",
    question:"Given what we know, what kind of transformation should move Reality toward the Requested Result?",
  }),
});

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{ "content-type":"application/json; charset=utf-8" },
  });
}

async function payload(response) {
  if (response instanceof Response) return response.clone().json().catch(() => ({}));
  return clone(response || {});
}

function okResponse(response) {
  return response instanceof Response ? response.ok : response?.ok !== false;
}

function lensEntries(ids = Object.keys(LENSES)) {
  return ids.map(lensId => ({ lensId, ...LENSES[lensId] }));
}

export function createAgentLensRoom({ readTablet, updateTablet } = {}) {
  return Object.freeze({
    async action(input = {}) {
      const action = text(input.action).toLowerCase();
      const base = {
        room:"AGENT_LENS_ROOM",
        siblingOf:"AGENT_PERSONA_ROOM",
        optional:true,
        entryMode:"OWNER_EXPLICIT_ONLY",
        autoEntry:false,
      };

      if (action === "list") {
        return json({
          ok:true,
          ...base,
          source:LENS_SOURCE,
          lenses:lensEntries(),
          selectedAutomatically:false,
        });
      }

      if (action === "compare") {
        const ids = Array.isArray(input.lensIds) && input.lensIds.length ? input.lensIds : Object.keys(LENSES);
        const normalized = ids.map(value => text(value).toUpperCase());
        const unknown = normalized.find(lensId => !LENSES[lensId]);
        if (unknown) return json({ code:"LENS_ROOM_LENS_UNKNOWN", lensId:unknown }, 404);
        return json({
          ok:true,
          ...base,
          source:LENS_SOURCE,
          lenses:lensEntries(normalized),
          selectedAutomatically:false,
          mutates:false,
          authorityCreated:false,
          routeChanged:false,
          workChanged:false,
        });
      }

      if (action !== "select") return json({ code:"LENS_ROOM_EXPLICIT_SELECT_REQUIRED" }, 400);

      const agentId = text(input.agentId);
      const lensId = text(input.lensId).toUpperCase();
      const tabletId = text(input.tabletId);
      const workId = text(input.workContext?.workId);
      const checkpointId = text(input.workContext?.checkpointId);
      if (!agentId) return json({ code:"LENS_ROOM_AGENT_REQUIRED" }, 400);
      if (!lensId) return json({ code:"LENS_ROOM_LENS_REQUIRED" }, 400);
      if (!LENSES[lensId]) return json({ code:"LENS_ROOM_LENS_UNKNOWN", lensId }, 404);
      if (!tabletId) return json({ code:"LENS_ROOM_TABLET_REQUIRED" }, 400);
      if (!workId || !checkpointId) return json({ code:"LENS_ROOM_WORK_CONTEXT_REQUIRED" }, 400);
      if (typeof readTablet !== "function" || typeof updateTablet !== "function") {
        return json({ code:"LENS_ROOM_TABLET_UPDATE_UNAVAILABLE" }, 503);
      }

      const currentResponse = await readTablet({
        tabletId,
        workContext:{ workId, checkpointId },
        accessScope:input.accessScope || "WORK",
      });
      if (!okResponse(currentResponse)) return currentResponse;
      const current = await payload(currentResponse);
      const currentData = current.data || current.tablet?.data || {};
      if (!currentData || typeof currentData !== "object" || Array.isArray(currentData)) {
        return json({ code:"LENS_ROOM_TABLET_DATA_UNAVAILABLE" }, 409);
      }

      const lens = LENSES[lensId];
      const lensSelection = {
        lensId,
        name:lens.name,
        kind:lens.kind,
        selectedBy:agentId,
        source:LENS_SOURCE,
      };
      const updatedResponse = await updateTablet({
        tabletId,
        workContext:{ workId, checkpointId },
        accessScope:input.accessScope || "WORK",
        data:{ ...clone(currentData), lensSelection },
      });
      if (!okResponse(updatedResponse)) return updatedResponse;
      const updated = await payload(updatedResponse);

      return json({
        ok:true,
        ...base,
        source:LENS_SOURCE,
        agentId,
        lens:{ lensId, ...lens, source:LENS_SOURCE, state:"ACTIVE" },
        confirmation:"LENS_SELECTED",
        selectedAutomatically:false,
        persisted:true,
        tabletId,
        workContext:{ workId, checkpointId },
        data:clone(updated.data || updated.tablet?.data || { ...currentData, lensSelection }),
        tablet:clone(updated.tablet || null),
        exited:true,
        authorityCreated:false,
        routeChanged:false,
        workChanged:false,
        workIdentityUnchanged:true,
        passOpened:false,
        toolAccessChanged:false,
      });
    },
  });
}
