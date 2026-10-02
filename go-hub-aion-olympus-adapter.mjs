const text = value => String(value ?? "").trim();

function unknown(reason, details = {}) {
  return Object.freeze({
    ok:true,
    source:"OLYMPUS",
    authority:"OLYMPUS_RELEASE_MANIFEST_V1",
    status:"UNKNOWN",
    reason,
    target:null,
    releaseTruthRef:null,
    executed:false,
    authorityCreated:false,
    routeSelected:false,
    ...details,
  });
}

export function createOlympusAionAdapter({
  fetchImpl = fetch,
  endpoint = "https://olympus.pureekangraw.workers.dev",
} = {}) {
  const base = text(endpoint).replace(/\/+$/, "");
  if (!base) throw new Error("OLYMPUS_AION_ENDPOINT_REQUIRED");
  if (typeof fetchImpl !== "function") throw new Error("OLYMPUS_AION_FETCH_REQUIRED");

  return Object.freeze({
    async resolve(input = {}) {
      const request = {
        appId:text(input.appId),
        version:text(input.version),
        sourceRevision:text(input.sourceRevision),
        artifactSha:text(input.artifactSha),
        destination:text(input.destination),
      };
      const missing = Object.entries(request).filter(([, value]) => !value).map(([key]) => key);
      if (missing.length) return unknown("RESOLUTION_INPUT_UNKNOWN", { unknowns:missing.map(key => key.toUpperCase() + "_UNKNOWN") });

      let response;
      try {
        response = await fetchImpl(base + "/aion/resolve", {
          method:"POST",
          headers:{ "content-type":"application/json" },
          body:JSON.stringify(request),
        });
      } catch {
        return unknown("OLYMPUS_AION_UNREACHABLE", { unknowns:["OLYMPUS_AION_UNREACHABLE"] });
      }

      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok || !payload || typeof payload !== "object") {
        return unknown("OLYMPUS_AION_UPSTREAM_ERROR", {
          upstreamStatus:Number(response.status || 0) || null,
          unknowns:["OLYMPUS_AION_UPSTREAM_ERROR"],
        });
      }

      const status = ["VERIFIED","STALE","MISMATCH","UNKNOWN"].includes(text(payload.status))
        ? text(payload.status)
        : "UNKNOWN";
      const safe = status === "VERIFIED";
      return Object.freeze({
        ok:true,
        source:"OLYMPUS",
        authority:"OLYMPUS_RELEASE_MANIFEST_V1",
        appId:text(payload.appId) || request.appId,
        version:text(payload.version) || request.version,
        sourceRevision:text(payload.sourceRevision) || request.sourceRevision,
        artifactSha:text(payload.artifactSha) || request.artifactSha,
        destination:text(payload.destination) || request.destination,
        status,
        reason:text(payload.reason) || null,
        target:safe ? (text(payload.target) || null) : null,
        releaseTruthRef:safe ? (text(payload.releaseTruthRef) || null) : null,
        verifiedAt:safe ? (text(payload.verifiedAt) || null) : null,
        unknowns:Array.isArray(payload.unknowns) ? payload.unknowns.map(text).filter(Boolean) : [],
        executed:false,
        authorityCreated:false,
        routeSelected:false,
      });
    },

    async registry() {
      let response;
      try {
        response = await fetchImpl(base + "/aion/registry", { method:"GET" });
      } catch {
        return unknown("OLYMPUS_AION_UNREACHABLE", { entries:[], unknowns:["OLYMPUS_AION_UNREACHABLE"] });
      }
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok || !payload || !Array.isArray(payload.entries)) {
        return unknown("OLYMPUS_AION_UPSTREAM_ERROR", { entries:[], upstreamStatus:Number(response.status || 0) || null });
      }
      return Object.freeze({
        ok:true,
        source:"OLYMPUS",
        authority:"OLYMPUS_RELEASE_MANIFEST_V1",
        schema:text(payload.schema) || "AION_TRUST_PROOF_V1",
        entries:structuredClone(payload.entries),
        executed:false,
        authorityCreated:false,
        routeSelected:false,
      });
    },
  });
}
