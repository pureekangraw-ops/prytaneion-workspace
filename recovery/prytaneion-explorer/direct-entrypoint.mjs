import { WorkerEntrypoint } from "cloudflare:workers";
import worker, { inspectDirectConnections } from "./worker.mjs";

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
