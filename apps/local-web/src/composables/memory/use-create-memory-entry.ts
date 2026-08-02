import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import type { VynelClient } from "@vynel/sdk";
import type { SectionScope } from "../../components/sections/section-scope.js";

type CreateMemoryEntryBody = Parameters<VynelClient["memory"]["create"]>[1];

/** Create a memory entry where the surface says it belongs: inside a workspace,
 *  or at the user level — a global memory, anchored to no workspace. */
export function useCreateMemoryEntry() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { scope: SectionScope; body: CreateMemoryEntryBody }) =>
      input.scope.kind === "workspace"
        ? vynel.memory.create(input.scope.workspaceId, input.body)
        : vynel.memoryUser.create(input.body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memory"] }),
  });
}
