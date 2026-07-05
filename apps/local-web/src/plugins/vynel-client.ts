import type { InjectionKey } from "vue";
import { createVynelClient, type VynelClient } from "@vynel/sdk";

export const vynelClientKey: InjectionKey<VynelClient> = Symbol("vynel-client");

// baseUrl '/api' rides the dev-server proxy (see vite.config.ts) — the local
// API is loopback-only with no CORS, so the browser never talks to it directly.
export function createLocalVynelClient(): VynelClient {
  return createVynelClient({ baseUrl: "/api" });
}
