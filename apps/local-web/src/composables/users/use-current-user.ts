import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** The single local user's profile — the display name feeds the greeting. */
export function useCurrentUser() {
  const vynel = useVynel();
  return useQuery({
    queryKey: ["users", "me"],
    queryFn: () => vynel.users.getMe(),
    staleTime: 5 * 60_000,
  });
}
