import { inject } from "vue";
import type { LocalVynelClient } from "../demo/demo-namespaces.js";
import { vynelClientKey } from "../plugins/vynel-client.js";

// The only sanctioned access point to the SDK client (letterman's
// useLetterman() boundary) — components never inject the key themselves.
export function useVynel(): LocalVynelClient {
  const client = inject(vynelClientKey);
  if (!client) {
    throw new Error(
      "Vynel client is not provided. main.ts must app.provide(vynelClientKey, createLocalVynelClient()); tests provide a fake via the same key.",
    );
  }
  return client;
}
