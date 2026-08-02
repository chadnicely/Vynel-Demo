import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

/** The add form's request shape — discriminated like the API body. Secret
 *  values (headers/env) ride OUT once, in this POST; every read comes back
 *  masked. */
export type AddMcpServerInput =
  | { scope: "user"; body: AddMcpServerBody }
  | { scope: "workspace"; workspaceId: string; body: AddMcpServerBody };

export type AddMcpServerBody =
  | {
      serverName: string;
      transport: "stdio";
      command: string;
      args: string[];
      environment: Record<string, string>;
    }
  | {
      serverName: string;
      transport: "http" | "sse";
      url: string;
      headers: Record<string, string>;
    };

/** Add a custom MCP server at either scope. A user-scope server shows on
 *  every surface, so the whole `["mcp-servers"]` prefix refreshes. */
export function useAddMcpServer() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddMcpServerInput) =>
      input.scope === "workspace"
        ? vynel.mcpServers.add(input.workspaceId, input.body)
        : vynel.mcpServersUser.add(input.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
  });
}
