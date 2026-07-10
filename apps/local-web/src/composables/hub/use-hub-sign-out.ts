import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { hubKeys } from "./hub-keys.js";

/** Sign this device out of the hub and refresh the whole hub surface. */
export function useHubSignOut() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => vynel.hub.signOut(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hubKeys.all }),
  });
}
