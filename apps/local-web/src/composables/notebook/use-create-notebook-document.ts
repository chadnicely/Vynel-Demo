import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { notebookKeys } from "./notebook-keys.js";
import type { VynelClient } from "@vynel/sdk";

type CreateNotebookDocumentInput = Parameters<
  VynelClient["notebook"]["createDocument"]
>[0];

/** Write a new book at either scope (global, or into one workspace). */
export function useCreateNotebookDocument() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNotebookDocumentInput) =>
      vynel.notebook.createDocument(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notebookKeys.all }),
  });
}
