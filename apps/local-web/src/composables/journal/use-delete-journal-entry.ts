import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateJournalViews } from "./journal-keys.js";

export function useDeleteJournalEntry() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { entryId: string }) =>
      vynel.journalUser.delete(input.entryId),
    onSuccess: () => invalidateJournalViews(queryClient),
  });
}
