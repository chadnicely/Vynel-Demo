import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { agentsKeys } from "./agents-keys.js";

/** The compiled-in curated agent catalog — the "Add from catalog" browse. */
export function useCuratedAgents(options: { enabled?: () => boolean } = {}) {
  const vynel = useVynel();
  return useQuery({
    queryKey: agentsKeys.curated(),
    queryFn: () => vynel.agents.listCurated(),
    enabled: options.enabled,
  });
}
