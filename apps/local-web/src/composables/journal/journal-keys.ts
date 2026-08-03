import type { QueryClient } from "@tanstack/vue-query";

export const journalKeys = {
  all: ["journal"] as const,
  list: () => [...journalKeys.all, "list"] as const,
  listInScope: (surfaceKey: string) =>
    [...journalKeys.all, "list", surfaceKey] as const,
};

// One surface today (the journal section on both scopes); a mutation
// refreshes the shared list.
export function invalidateJournalViews(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: journalKeys.all });
}
