import { inject } from "vue";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../plugins/vynel-client.js";

// The only sanctioned access point to the SDK client (letterman's
// useLetterman() boundary) — components never inject the key themselves.
export function useVynel(): VynelClient {
  const client = inject(vynelClientKey);
  if (!client) {
    throw new Error(
      "Vynel client is not provided. main.ts must app.provide(vynelClientKey, createLocalVynelClient()); tests provide a fake via the same key.",
    );
  }
  return client;
}
