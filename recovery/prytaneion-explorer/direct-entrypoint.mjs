import { WorkerEntrypoint } from "cloudflare:workers";
import worker, { inspectDirectConnections } from "./worker.mjs";
import { providerMcp } from './provider-mcp.mjs';

// Preserve public HTTP behavior. No public route can activate these probes.
export default worker;

// Requires an explicitly configured named Service Binding at a caller.
// No caller is configured by this patch. Fixed read-only status probe only.
export class HubDirectRead extends WorkerEntrypoint {
  async probe(...args) {
    if (args.length) return { status: "INVALID_INPUT", readOnly: true };
    return inspectDirectConnections(this.env, fetch, { force: true });
  }
}
// Only the Hub V2 named binding receives this capability. No public HTTP route.
export class ProviderTools extends WorkerEntrypoint {
  fetch(request) { return providerMcp(request, this.env); }
}

