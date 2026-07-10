import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Import one on-disk file as a memory entry — the server parses it
 *  (md/txt/pdf/docx/html/csv/json) and rejects oversized files with a
 *  pointer to Knowledge. */
export function useImportMemoryFile() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      workspaceId: string;
      absolutePath: string;
      tags?: string[];
    }) =>
      vynel.memory.importFile(input.workspaceId, {
        absolutePath: input.absolutePath,
        ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memory"] }),
  });
}
