import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";

type CreateMemoryEntryBody = Parameters<VynelClient["memory"]["create"]>[1];

/** Create a memory entry in a workspace (memory is workspace-owned today). */
export function useCreateMemoryEntry() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      workspaceId: string;
      body: CreateMemoryEntryBody;
    }) => vynel.memory.create(input.workspaceId, input.body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memory"] }),
  });
}
