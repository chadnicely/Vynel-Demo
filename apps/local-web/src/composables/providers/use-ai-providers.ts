import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import { useVynel } from "../use-vynel.js";

// Which AI accounts this computer is actually signed in to. The engine reads
// each provider's own CLI, so this is real state, never a guess — "Finish
// setting up" and Connections both stand on it.
export function useAiProviders() {
  const vynel = useVynel();
  const query = useQuery({
    queryKey: ["providers", "auth"],
    queryFn: () => vynel.providers.list(),
    staleTime: 10_000,
  });

  const signedIn = computed(
    () => query.data.value?.filter((provider) => provider.isAuthenticated) ?? [],
  );

  return { query, signedIn, hasBuilder: computed(() => signedIn.value.length > 0) };
}
