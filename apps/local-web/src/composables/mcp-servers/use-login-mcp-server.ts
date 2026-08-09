import { useMutation } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

export type LoginMcpServerInput =
  | { scope: "user"; serverName: string }
  | { scope: "workspace"; workspaceId: string; serverName: string };

/** Sign in to a remote MCP server — drives the native `claude mcp login`
 *  browser flow through the daemon. The row's scope picks the route (the
 *  remove composable's rule); re-running refreshes an existing sign-in
 *  (idempotent — the CLI stores a fresh credential). No invalidation:
 *  nothing config-side changes; the credential lives in Claude's own
 *  store. */
export function useLoginMcpServer() {
  const vynel = useVynel();
  return useMutation({
    mutationFn: (input: LoginMcpServerInput) =>
      input.scope === "workspace"
        ? vynel.mcpServers.login(input.workspaceId, input.serverName)
        : vynel.mcpServersUser.login(input.serverName),
  });
}
