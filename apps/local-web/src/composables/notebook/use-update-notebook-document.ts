import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { notebookKeys } from "./notebook-keys.js";
import type { VynelClient } from "@vynel/sdk";

type UpdateNotebookDocumentBody = Parameters<
  VynelClient["notebook"]["updateDocument"]
>[1];

/** Edit one of the user's OWN books (title / body / enabled) — verified
 *  books have no document id, so they can never reach this mutation. */
export function useUpdateNotebookDocument() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      documentId: string;
      body: UpdateNotebookDocumentBody;
    }) => vynel.notebook.updateDocument(input.documentId, input.body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notebookKeys.all }),
  });
}
