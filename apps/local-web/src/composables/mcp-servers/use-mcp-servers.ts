import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SectionScope } from "../../components/sections/section-scope.js";
import { useVynel } from "../use-vynel.js";

/** The MCP servers a SURFACE resolves, MASKED (header/env values never reach
 *  the client): a workspace drawer lists user ∪ that workspace's config with
 *  scope chips; the global menu lists ~/.claude.json only. Keyed under
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
