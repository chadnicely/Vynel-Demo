import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { toolPolicyKeys } from "./tool-policy-keys.js";

/** The EFFECTIVE tool-policy matrix — every composed tool with its declared
 *  defaults merged against the user's overrides. USER-scoped (machine-level
 *  policy), so the global menu and every workspace read the same list: one
 *  key, no scope discriminant. */
export function useToolPolicies() {
  const vynel = useVynel();
  return useQuery({
    queryKey: toolPolicyKeys.list(),
    queryFn: async () => {
      const response = await vynel.toolPolicies.list();
      return response.tools;
    },
  });
}
