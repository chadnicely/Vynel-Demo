import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** The user's registered Claude plugin marketplaces (the GLOBAL surface's
 *  source management). Mutations invalidate BOTH the sources list and the
 *  marketplace shelf — registering/removing a source changes what the
 *  shelf lists. */
export function useMarketplaceSources(enabled: () => boolean) {
  const vynel = useVynel();
  return useQuery({
    queryKey: ["marketplace", "sources"],
    queryFn: async () => (await vynel.marketplaceSources.list()).sources,
    enabled,
  });
}

export function useAddMarketplaceSource() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { source: string }) => vynel.marketplaceSources.add(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });
}

export function useRemoveMarketplaceSource() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { marketplaceName: string }) =>
      vynel.marketplaceSources.remove(input.marketplaceName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });
}
