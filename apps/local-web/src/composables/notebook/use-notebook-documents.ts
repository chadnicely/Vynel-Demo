import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { notebookKeys } from "./notebook-keys.js";

/** Every book the user owns — the management view (both scopes, disabled
 *  included), unlike the shelf, which is Claude's enabled-only view. */
export function useNotebookDocuments() {
  const vynel = useVynel();
  return useQuery({
    queryKey: notebookKeys.documents(),
    queryFn: async () => {
      const response = await vynel.notebook.listDocuments();
      return response.documents;
    },
  });
}
