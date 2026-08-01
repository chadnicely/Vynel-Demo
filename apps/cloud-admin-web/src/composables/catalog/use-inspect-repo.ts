import { useMutation } from "@tanstack/vue-query";
import { adminApiFetch } from "../../lib/admin-api.js";

/** POST /admin/catalog/inspect-repo — the publish-from-repo preview. The hub
 *  clones the pinned folder and answers with the vynel-item.json prefill
 *  (lenient) or the detected entry file + kind guess. Read-only: no cache
 *  invalidation. */
export interface InspectRepoInput {
  url: string;
  ref?: string;
  subpath?: string;
}

export interface InspectRepoResponse {
  resolvedSha: string;
  sourceUrl: string;
  manifest: {
    publisher?: {
      id?: string;
      name?: string;
      tier?: "verified" | "anthropic-official" | "community";
      url?: string | null;
    };
    item?: {
      itemId?: string;
      kind?: "skill" | "agent" | "mcp" | "rule" | "plugin";
      displayName?: string;
      oneLineDescription?: string;
      category?: string;
      iconName?: string;
      recommendedScope?: "user" | "workspace" | "both" | null;
      sourceUrl?: string | null;
      minimumTier?: "basic" | "pro";
      status?: "draft" | "published";
    };
    version?: {
      version?: string;
      changelog?: string;
      manifest?: Record<string, unknown>;
      minAppVersion?: string | null;
    };
  } | null;
  detectedKind: "skill" | "agent" | "mcp" | "rule" | "plugin" | null;
  entryFile: string | null;
}

export function useInspectRepo() {
  return useMutation({
    mutationFn: (input: InspectRepoInput) =>
      adminApiFetch<InspectRepoResponse>("/admin/catalog/inspect-repo", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}
