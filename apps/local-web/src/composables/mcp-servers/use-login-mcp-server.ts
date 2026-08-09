import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

export type LoginMcpServerInput =
  | { scope: "user"; serverName: string }
  | { scope: "workspace"; workspaceId: string; serverName: string };

/** Sign in to a remote MCP server — drives the native `claude mcp login`
 *  browser flow through the daemon. The row's scope picks the route (the
 *  remove composable's rule); re-running refreshes an existing sign-in
 *  (idempotent — the CLI stores a fresh credential). Invalidates the
 *  listings so every row's persisted `signedIn` re-reads the credential
 *  store the CLI just wrote. */
export function useLoginMcpServer() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginMcpServerInput) =>
      input.scope === "workspace"
        ? vynel.mcpServers.login(input.workspaceId, input.serverName)
        : vynel.mcpServersUser.login(input.serverName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
  });
}
