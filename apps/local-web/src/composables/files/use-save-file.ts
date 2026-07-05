import { toValue, type MaybeRefOrGetter } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

interface SaveFileInput {
  path: string;
  content: string;
}

export function useSaveFile(workspaceId: MaybeRefOrGetter<string>) {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: SaveFileInput) =>
      vynel.files.saveContent(toValue(workspaceId), { path, content }),
    onSuccess: (_result, { path }) => {
      const wsId = toValue(workspaceId);
      // The saved buffer is now stale on disk metadata (size, modifiedAt) —
      // refetch this file's content and every tree listing for the workspace
      // (the containing directory's row changed).
      void queryClient.invalidateQueries({
        queryKey: ["files", "content", wsId, path],
      });
      void queryClient.invalidateQueries({ queryKey: ["files", "tree", wsId] });
    },
  });
}
