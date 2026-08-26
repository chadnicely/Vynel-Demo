import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { commandsKeys } from "./commands-keys.js";
import type { VynelClient } from "@vynel/sdk";

type DeleteCommandScope = Parameters<VynelClient["commands"]["delete"]>[1];

/** Delete one slash-command file at a scope — gone from disk. */
export function useDeleteCommand() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { commandName: string; scope: DeleteCommandScope }) =>
      vynel.commands.delete(input.commandName, input.scope),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: commandsKeys.all }),
  });
}
