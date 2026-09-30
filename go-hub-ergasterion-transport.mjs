import { HUB_FACTORY_PROTOCOL } from './go-hub-ergasterion-bridge.mjs';

const text = value => String(value ?? '').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function signature(payload, secret, timestamp) {
  if (!text(secret)) throw new Error('HUB_FACTORY_SECRET_REQUIRED');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${JSON.stringify(payload)}`));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function postJson({ endpoint, payload, secret, fetchImpl = fetch, timeoutMs = 8000, retries = 2 } = {}) {
  const url = text(endpoint);
  if (!url) throw new Error('FACTORY_ENDPOINT_REQUIRED');
  const body = JSON.stringify(payload);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const timestamp = String(Date.now());
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-go-hub-timestamp': timestamp, 'x-go-hub-signature': await signature(payload, secret, timestamp), 'x-go-hub-protocol': HUB_FACTORY_PROTOCOL }, body, signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (response.ok) return result;
      if (response.status < 500 && response.status !== 408 && response.status !== 429) throw new Error(`FACTORY_HTTP_${response.status}`);
      lastError = new Error(`FACTORY_HTTP_${response.status}`);
    } catch (error) { lastError = error; }
    finally { clearTimeout(timer); }
    if (attempt < retries) await sleep(100 * (attempt + 1));
  }
  throw lastError || new Error('FACTORY_TRANSPORT_FAILED');
}

export function sendErgasterionFactoryHandoff(input = {}) {
  return postJson({ ...input, endpoint: `${text(input.endpoint).replace(/\/$/, '')}/api/hub-factory/receive`, payload: input.handoff });
}

export function readErgasterionFactoryReadback(input = {}) {
  return postJson({ ...input, endpoint: `${text(input.endpoint).replace(/\/$/, '')}/api/hub-factory/readback`, payload: input.readback });
}
