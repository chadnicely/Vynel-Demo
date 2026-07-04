import { QueryClient } from "@tanstack/vue-query";

// One QueryClient for the app (letterman conventions): server state lives in
// vue-query, Pinia holds UI state only.
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  });
}
