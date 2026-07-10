import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { hubKeys } from "./hub-keys.js";

/** The daemon's hub-account link status (the HubLinkStatus union). */
export function useHubSession() {
  const vynel = useVynel();
  return useQuery({
    queryKey: hubKeys.session(),
    queryFn: () => vynel.hub.getSession(),
    // While the link is offline the daemon retries on its own — poll so the
    // recovery shows up here without a manual refresh.
    refetchInterval: (query) =>
      query.state.data?.kind === "offline" ? 15_000 : false,
  });
}
