import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { hubKeys } from "./hub-keys.js";

/** Revoke one signed-in device. Invalidates the whole hub key: revoking THIS
 *  device signs the app out, and the session refetch is what reflects that. */
export function useRevokeHubDevice() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => vynel.hub.revokeDevice(deviceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hubKeys.all }),
  });
}
