import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** The MCP servers a SURFACE OWNS, MASKED (header/env values never reach the
 *  client): a workspace drawer lists that workspace's own `.mcp.json`, the
 *  global menu `~/.claude.json`. One config file per surface, so the list
 *  agrees with the add/remove beside it — listing user rows in a room is what
 *  let a click there delete a server from every room. Keyed under
 *  `["mcp-servers"]` so an add/remove on either surface refreshes both. */
export function useMcpServers(scope: MaybeRefOrGetter<SectionScope>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => {
      const surface = toValue(scope);
      return [
        "mcp-servers",
        "list",
        surface.kind === "workspace" ? surface.workspaceId : "user",
      ];
    }),
    queryFn: async () => {
      const surface = toValue(scope);
      const response =
        surface.kind === "workspace"
          ? await vynel.mcpServers.list(surface.workspaceId)
          : await vynel.mcpServersUser.list();
      return response.servers;
    },
  });
}
