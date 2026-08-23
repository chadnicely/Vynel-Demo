import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";

// What git knows about the active workspace's folder, read fresh from the
// API (the sessions commit and branch on Bash without telling Vynel, so the
// header re-reads on a short interval rather than trusting a cache).

export type WorkspaceGit = Awaited<
  ReturnType<VynelClient["workspaces"]["getGit"]>
>;
export type GitFacts = WorkspaceGit["facts"];

const REFRESH_MS = 30_000;

export function useWorkspaceGit(workspaceId: Ref<string | null>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(
      () => [...workspaceKeys.all, "git", workspaceId.value] as const,
    ),
    queryFn: () => vynel.workspaces.getGit(workspaceId.value!),
    enabled: computed(() => workspaceId.value !== null),
    staleTime: 10_000,
    refetchInterval: REFRESH_MS,
  });
}
