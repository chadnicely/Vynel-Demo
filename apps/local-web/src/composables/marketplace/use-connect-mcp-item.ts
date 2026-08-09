import { useMutation } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** Connect an installed OAuth MCP item — drives the native `claude mcp
 *  login` browser flow through the daemon. The route split follows where
 *  the entry actually LIVES (installStatus.scope), not the surface the
 *  card is on: a user-scope install signs in via the global config route
 *  even from a workspace shelf. No query invalidation — the config entry
 *  is unchanged; the credential lands in the CLI's own store. */
export function useConnectMcpItem() {
  const vynel = useVynel();
  return useMutation({
    mutationFn: (input: {
      itemId: string;
      serverName: string;
      installScope: "user" | "workspace";
      workspaceId: string | null;
    }) =>
      input.installScope === "workspace" && input.workspaceId !== null
        ? vynel.mcpServers.login(input.workspaceId, input.serverName)
        : vynel.mcpServersUser.login(input.serverName),
  });
}
