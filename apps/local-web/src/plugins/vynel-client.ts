import type { InjectionKey } from "vue";
import { createVynelClient } from "@vynel/sdk";
import { attachDemoNamespaces } from "../demo/demo-namespaces.js";
import type { LocalVynelClient } from "../demo/demo-namespaces.js";

export const vynelClientKey: InjectionKey<LocalVynelClient> =
  Symbol("vynel-client");

// baseUrl '/api' rides the dev-server proxy (see vite.config.ts) — the local
// API is loopback-only with no CORS, so the browser never talks to it directly.
// Demo namespaces cover the surfaces whose routes don't exist yet (Slice-3);
// the six generated namespaces hit the real API.
export function createLocalVynelClient(): LocalVynelClient {
  return attachDemoNamespaces(createVynelClient({ baseUrl: "/api" }));
}
