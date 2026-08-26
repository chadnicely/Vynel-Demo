import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { commandsKeys } from "./commands-keys.js";
import type { VynelClient } from "@vynel/sdk";

type WriteCommandBody = Parameters<VynelClient["commands"]["write"]>[1];

/** Create or replace one of the user's OWN slash commands at either scope —
 *  the engine renders the file from these parts. */
export function useWriteCommand() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { commandName: string; body: WriteCommandBody }) =>
      vynel.commands.write(input.commandName, input.body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: commandsKeys.all }),
  });
}
