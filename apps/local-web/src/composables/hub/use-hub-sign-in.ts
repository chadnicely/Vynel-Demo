import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { hubKeys } from "./hub-keys.js";

type HubSignInInput = Parameters<VynelClient["hub"]["signIn"]>[0];

/** Sign in to the Vynel hub — success flips the whole hub surface, so
 *  everything under the hub key refetches. */
export function useHubSignIn() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: HubSignInInput) => vynel.hub.signIn(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hubKeys.all }),
  });
}
