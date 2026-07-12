import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { notebookKeys } from "./notebook-keys.js";

/** Delete one of the user's OWN books. */
export function useDeleteNotebookDocument() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: string }) =>
      vynel.notebook.deleteDocument(input.documentId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notebookKeys.all }),
  });
}
