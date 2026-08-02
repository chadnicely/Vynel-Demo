import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

export type RemoveMcpServerInput =
  | { scope: "user"; serverName: string }
  | { scope: "workspace"; workspaceId: string; serverName: string };

/** Remove an MCP server from ITS OWN config file — the row's scope picks the
 *  route (a user row always removes from ~/.claude.json, even when the button
 *  sits on a workspace surface). */
export function useRemoveMcpServer() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RemoveMcpServerInput) =>
      input.scope === "workspace"
        ? vynel.mcpServers.remove(input.workspaceId, input.serverName)
        : vynel.mcpServersUser.remove(input.serverName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
  });
}
