import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { SectionScope } from "../../components/sections/section-scope.js";

/** Import one on-disk file as a memory entry — the server parses it
 *  (md/txt/pdf/docx/html/csv/json) and rejects oversized files with a
 *  pointer to Knowledge. Lands where the surface says, like a written one. */
export function useImportMemoryFile() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      scope: SectionScope;
      absolutePath: string;
      tags?: string[];
    }) => {
      const body = {
        absolutePath: input.absolutePath,
        ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
      };
      return input.scope.kind === "workspace"
        ? vynel.memory.importFile(input.scope.workspaceId, body)
        : vynel.memoryUser.importFile(body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memory"] }),
  });
}
