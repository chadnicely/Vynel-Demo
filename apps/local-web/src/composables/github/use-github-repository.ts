import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "../workspaces/workspace-keys.js";

// Making the GitHub repository for a workspace folder — the wizard's Finish
// and the header's "Connect to GitHub" share this one door. The outcome is
// data (created / failed with gh's reason), never a thrown error, so the
// screens word it; a created repository refreshes the header's git facts.

export type RepositoryVisibility = "private" | "public";

export type GitHubRepositoryOutcome = Awaited<
  ReturnType<VynelClient["workspaces"]["createGitHubRepository"]>
>["outcome"];

export function useCreateGitHubRepository() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      workspaceId: string;
      name: string;
      visibility: RepositoryVisibility;
    }): Promise<GitHubRepositoryOutcome> => {
      const { outcome } = await vynel.workspaces.createGitHubRepository(
        input.workspaceId,
        { name: input.name, visibility: input.visibility },
      );
      return outcome;
    },
    onSuccess: (_outcome, input) => {
      void queryClient.invalidateQueries({
        queryKey: [...workspaceKeys.all, "git", input.workspaceId],
      });
    },
  });
}

/** GitHub's own naming applied to a workspace name: "Front of House!" →
 *  "front-of-house". Empty when nothing survives. */
export function suggestRepositoryName(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-]+$/g, "")
    .slice(0, 100);
}
