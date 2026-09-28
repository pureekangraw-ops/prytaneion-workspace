const CLOUDFLARE_API_ROOT = "https://api.cloudflare.com/client/v4";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function configured(token, accountId) {
  return Boolean(text(token) && text(accountId));
}

function sanitizeBinding(binding = {}) {
  return {
    name: text(binding.name) || null,
    type: text(binding.type) || null,
  };
}

function sanitizeDeployment(deployment = {}) {
  const versions = Array.isArray(deployment.versions) ? deployment.versions : [];
  return {
    id: text(deployment.id) || null,
    createdOn: text(deployment.created_on || deployment.createdOn) || null,
    source: text(deployment.source) || null,
    strategy: text(deployment.strategy) || null,
    versions: versions.map(version => ({
      versionId: text(version.version_id || version.versionId) || null,
      percentage: Number.isFinite(Number(version.percentage)) ? Number(version.percentage) : null,
    })).filter(version => version.versionId),
  };
}

function sanitizeWorker(worker = {}) {
  return {
    id: text(worker.id) || null,
    createdOn: text(worker.created_on || worker.createdOn) || null,
    modifiedOn: text(worker.modified_on || worker.modifiedOn) || null,
    etag: text(worker.etag) || null,
  };
}

function errorCategory(payload, status) {
  const first = Array.isArray(payload?.errors) ? payload.errors[0] : null;
  const code = first?.code == null ? null : String(first.code);
  return code ? "CF_" + code : "HTTP_" + String(status || 0);
}

export function createCloudflareService({ fetchImpl = fetch, token, accountId } = {}) {
  const fixedToken = text(token);
  const fixedAccountId = text(accountId);

  async function request(path) {
    if (!configured(fixedToken, fixedAccountId)) {
      return { response: json({ code:"CLOUDFLARE_NOT_CONFIGURED" }, 503) };
    }
    let upstream;
    try {
      upstream = await fetchImpl(CLOUDFLARE_API_ROOT + path, {
        method:"GET",
        headers:{
          authorization:"Bearer " + fixedToken,
          accept:"application/json",
          "user-agent":"go-hub-cloudflare-bridge",
        },
      });
    } catch {
      return { response: json({ code:"CLOUDFLARE_UPSTREAM_ERROR", category:"NETWORK_ERROR" }, 502) };
    }
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || !payload || payload.success === false) {
      return {
        response: json({
          code:"CLOUDFLARE_UPSTREAM_ERROR",
          category:errorCategory(payload, upstream.status),
        }, upstream.status === 401 || upstream.status === 403 ? 502 : 502),
      };
    }
    return { payload };
  }

  function accountPath(suffix) {
    return "/accounts/" + encodeURIComponent(fixedAccountId) + suffix;
  }

  return Object.freeze({
    capabilities() {
      return json({
        configured: configured(fixedToken, fixedAccountId),
        tokenConfigured: Boolean(fixedToken),
        accountConfigured: Boolean(fixedAccountId),
        secretValuesExposed: false,
        operations:["health","list_workers","inspect_worker"],
        mutationMode:"FACTORY_ONLY",
      });
    },

    async health() {
      const result = await request(accountPath("/workers/scripts"));
      if (result.response) return result.response;
      const workers = Array.isArray(result.payload?.result) ? result.payload.result : [];
      return json({
        ok:true,
        upstream:"PASS",
        workerCount:workers.length,
        tokenConfigured:true,
        accountConfigured:true,
        secretValuesExposed:false,
      });
    },

    async listWorkers() {
      const result = await request(accountPath("/workers/scripts"));
      if (result.response) return result.response;
      const workers = Array.isArray(result.payload?.result) ? result.payload.result : [];
      return json({ workers: workers.map(sanitizeWorker) });
    },

    async inspectWorker(input = {}) {
      const scriptName = text(input.scriptName);
      if (!scriptName) return json({ code:"CLOUDFLARE_INVALID_INPUT" }, 400);
      const base = accountPath("/workers/scripts/" + encodeURIComponent(scriptName));
      const settings = await request(base + "/settings");
      if (settings.response) return settings.response;
      const settingsPayload = settings.payload?.result || {};
      const bindings = Array.isArray(settingsPayload.bindings)
        ? settingsPayload.bindings.map(sanitizeBinding)
        : [];

      const deploymentsResult = await request(base + "/deployments");
      let deployments = [];
      let deploymentsStatus = "PASS";
      if (deploymentsResult.response) {
        deploymentsStatus = "UNAVAILABLE";
      } else {
        const raw = deploymentsResult.payload?.result;
        const entries = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.deployments) ? raw.deployments : [];
        deployments = entries.map(sanitizeDeployment);
      }

      return json({
        worker:{
          name:scriptName,
          bindings,
          compatibilityDate:text(settingsPayload.compatibility_date || settingsPayload.compatibilityDate) || null,
          compatibilityFlags:Array.isArray(settingsPayload.compatibility_flags) ? settingsPayload.compatibility_flags : [],
        },
        deployments,
        deploymentsStatus,
        secretValuesExposed:false,
      });
    },
  });
}
