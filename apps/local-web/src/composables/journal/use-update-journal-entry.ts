import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import { invalidateJournalViews } from "./journal-keys.js";

type UpdateJournalEntryPatch = Parameters<
  VynelClient["journalUser"]["update"]
>[1];

/** Edit an entry (content/date) — the USER's door; the agent never edits history. */
export function useUpdateJournalEntry() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      entryId,
      ...patch
    }: { entryId: string } & UpdateJournalEntryPatch) =>
      vynel.journalUser.update(entryId, patch),
    onSuccess: () => invalidateJournalViews(queryClient),
  });
}
