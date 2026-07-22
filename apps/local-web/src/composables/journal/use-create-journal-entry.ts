import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import { invalidateJournalViews } from "./journal-keys.js";

type CreateJournalEntryInput = Parameters<
  VynelClient["journalUser"]["create"]
>[0];

/** Append an entry at either scope (global, or pinned to one workspace). */
export function useCreateJournalEntry() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateJournalEntryInput) =>
      vynel.journalUser.create(input),
    onSuccess: () => invalidateJournalViews(queryClient),
  });
}
