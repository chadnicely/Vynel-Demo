import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";

export const userPreferenceKeys = {
  all: ["user-preferences"] as const,
};

/** The resolved preferences, as the engine answers them (defaults filled). */
export type UserPreferences = Awaited<ReturnType<VynelClient["users"]["getPreferences"]>>;
export type UserPreferencesPatch = Parameters<VynelClient["users"]["updatePreferences"]>[0];

export function useUserPreferences() {
  const vynel = useVynel();
  return useQuery({
    queryKey: userPreferenceKeys.all,
    queryFn: () => vynel.users.getPreferences(),
  });
}

/** Write one or more preferences; the engine answers with the resolved set,
 *  which replaces the cached one — no second round-trip. */
export function useUpdateUserPreferences() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UserPreferencesPatch) => vynel.users.updatePreferences(patch),
    onSuccess: (resolved) => queryClient.setQueryData(userPreferenceKeys.all, resolved),
  });
}
