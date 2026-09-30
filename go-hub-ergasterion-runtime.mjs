import {
  createErgasterionFactoryHandoff,
  verifyErgasterionFactoryReadback,
} from './go-hub-ergasterion-bridge.mjs';
import { sendErgasterionFactoryHandoff } from './go-hub-ergasterion-transport.mjs';

const text = value => String(value ?? '').trim();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function serviceBindingFetch(binding) {
  if (!binding || typeof binding.fetch !== 'function') return null;
  return (resource, init) => binding.fetch(new Request(resource, init));
}

export function createErgasterionRuntime({ endpoint, secret, fetchImpl = fetch, binding = null } = {}) {
  const boundFetch = serviceBindingFetch(binding);
  const factoryEndpoint = text(endpoint) || (boundFetch ? 'https://ergasterion.internal' : '');
  const sharedSecret = text(secret);
  const transportFetch = boundFetch || fetchImpl;
  const transportMode = boundFetch ? 'SERVICE_BINDING' : 'PUBLIC_URL';

  return Object.freeze({
    async health() {
      if (!factoryEndpoint) return json({ ok:false, code:'ERGASTERION_FACTORY_ENDPOINT_NOT_CONFIGURED' }, 503);
      const response = await transportFetch(`${factoryEndpoint.replace(/\/$/, '')}/api/hub-factory/health`, {
        method:'GET',
        headers:{ 'accept':'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      return json({ ...payload, hubTransportMode:transportMode }, response.status);
    },

    async handoff(input = {}) {
      if (!factoryEndpoint) return json({ ok:false, code:'ERGASTERION_FACTORY_ENDPOINT_NOT_CONFIGURED' }, 503);
      if (!sharedSecret) return json({ ok:false, code:'ERGASTERION_HUB_SHARED_SECRET_NOT_CONFIGURED' }, 503);

      let handoff;
      try {
        handoff = createErgasterionFactoryHandoff({
          handoffId:input.handoffId,
          workContext:input.workContext,
          requestedResult:input.requestedResult,
          experimentId:input.experimentId,
          variantId:input.variantId,
          candidateRefs:input.candidateRefs,
          artifactRefs:input.artifactRefs,
          evidenceRefs:input.evidenceRefs,
          unknowns:input.unknowns,
        });
      } catch (error) {
        return json({ ok:false, code:error?.message || 'ERGASTERION_HANDOFF_INVALID' }, 400);
      }

      try {
        const receipt = await sendErgasterionFactoryHandoff({
          endpoint:factoryEndpoint,
          secret:sharedSecret,
          handoff,
          fetchImpl:transportFetch,
          timeoutMs:input.timeoutMs,
          retries:input.retries,
        });
        const proof = verifyErgasterionFactoryReadback({ handoff, readback:receipt });
        return json({
          ok:true,
          status:proof.status,
          handoff,
          receipt,
          verified:proof,
          transport:{ authenticated:true, mode:transportMode, endpoint:factoryEndpoint },
        });
      } catch (error) {
        return json({
          ok:false,
          code:error?.message || 'ERGASTERION_TRANSPORT_FAILED',
          handoffId:handoff.handoffId,
          workId:handoff.workId,
          checkpointId:handoff.checkpointId,
          transportMode,
        }, 502);
      }
    },
  });
}
