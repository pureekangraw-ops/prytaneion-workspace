const PIXIE_REPOSITORY = "pureekangraw-ops/Go-Calalog-";
const PIXIE_WORKFLOW = "pixie-lab-v1.yml";
const PIXIE_REF = "main";
const PIXIE_STATE_REF = "pixie-runtime-state";
const PIXIE_RESULT_PATH = ".pixie/last-result.json";
const MAX_COMMAND_JSON_CHARS = 20000;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{ "content-type":"application/json; charset=utf-8" },
  });
}

function clean(value) {
  return String(value ?? "").trim();
}

function githubHeaders(token) {
  return {
    authorization:"Bearer " + token,
    accept:"application/vnd.github+json",
    "content-type":"application/json",
    "x-github-api-version":"2022-11-28",
    "user-agent":"go-hub-pixie-bridge",
  };
}

function pathForApi(path) {
  return String(path || "").split("/").map(encodeURIComponent).join("/");
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value || "").replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function validRequestId(value) {
  const id = clean(value);
  return id.length >= 1 && id.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(id) ? id : null;
}

function commandEnvelope(command, args) {
  const name = clean(command);
  if (!name || name.length > 80) return { error:"PIXIE_COMMAND_INVALID" };
  if (args == null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) return { error:"PIXIE_COMMAND_ARGS_INVALID" };
  const encoded = JSON.stringify({ command:name, args });
  if (encoded.length > MAX_COMMAND_JSON_CHARS) return { error:"PIXIE_COMMAND_TOO_LARGE" };
  return { name, args, encoded };
}

export function createPixieCommandService({
  fetchImpl = fetch,
  token,
  repository = PIXIE_REPOSITORY,
  workflow = PIXIE_WORKFLOW,
  ref = PIXIE_REF,
  stateRef = PIXIE_STATE_REF,
} = {}) {
  const auth = clean(token);
  const repo = clean(repository);
  const workflowFile = clean(workflow);
  const codeRef = clean(ref);
  const runtimeRef = clean(stateRef);

  return Object.freeze({
    async command({ requestId, command, args = {} } = {}) {
      if (!auth) return json({ code:"PIXIE_GITHUB_NOT_CONFIGURED" }, 503);
      const id = validRequestId(requestId);
      if (!id) return json({ code:"PIXIE_REQUEST_ID_INVALID" }, 400);
      const envelope = commandEnvelope(command, args);
      if (envelope.error) return json({ code:envelope.error }, 400);

      const endpoint = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method:"POST",
          headers:githubHeaders(auth),
          body:JSON.stringify({
            ref:codeRef,
            inputs:{
              request_id:id,
              command_json:envelope.encoded,
            },
          }),
        });
      } catch (error) {
        return json({ code:"PIXIE_DISPATCH_UNREACHABLE", message:error?.message || "GitHub dispatch failed" }, 502);
      }
      if (!response.ok) {
        return json({ code:"PIXIE_DISPATCH_UPSTREAM_ERROR", upstreamStatus:response.status }, 502);
      }
      return json({
        ok:true,
        status:"QUEUED",
        requestId:id,
        command:envelope.name,
        repository:repo,
        workflow:workflowFile,
        ref:codeRef,
        resultRef:`github://${repo}@${runtimeRef}#${PIXIE_RESULT_PATH}`,
      }, 202);
    },

    async result({ requestId } = {}) {
      if (!auth) return json({ code:"PIXIE_GITHUB_NOT_CONFIGURED" }, 503);
      const id = validRequestId(requestId);
      if (!id) return json({ code:"PIXIE_REQUEST_ID_INVALID" }, 400);

      const endpoint = `https://api.github.com/repos/${repo}/contents/${pathForApi(PIXIE_RESULT_PATH)}?ref=${encodeURIComponent(runtimeRef)}`;
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method:"GET",
          headers:githubHeaders(auth),
        });
      } catch (error) {
        return json({ code:"PIXIE_RESULT_UNREACHABLE", message:error?.message || "GitHub result read failed" }, 502);
      }
      if (response.status === 404) {
        return json({ ok:true, status:"WAIT", requestId:id, reason:"PIXIE_RESULT_NOT_READY" });
      }
      if (!response.ok) {
        return json({ code:"PIXIE_RESULT_UPSTREAM_ERROR", upstreamStatus:response.status }, 502);
      }

      const meta = await response.json().catch(() => null);
      let result;
      try {
        result = JSON.parse(decodeBase64Utf8(meta?.content));
      } catch {
        return json({ code:"PIXIE_RESULT_INVALID" }, 502);
      }

      const observedRequestId = clean(result?.requestId);
      if (observedRequestId !== id) {
        return json({
          ok:true,
          status:"WAIT",
          requestId:id,
          reason:"PIXIE_RESULT_NOT_READY",
          observedRequestId:observedRequestId || null,
        });
      }

      return json({
        ok:true,
        status:result?.ok === true ? "ANSWERED" : "FAILED",
        requestId:id,
        result,
        evidenceRef:`github://${repo}@${runtimeRef}#${meta?.sha || PIXIE_RESULT_PATH}`,
      });
    },
  });
}
