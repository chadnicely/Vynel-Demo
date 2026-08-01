import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminCatalogKeys } from "./catalog-keys.js";
import type { PublishCatalogVersionInput } from "./use-publish-catalog-version.js";

/** The wire shape of POST /admin/catalog/publish-from-repo —
 *  PublishFromRepoSchema (packages/registry/src/publish-from-repo.ts): the
 *  publish body minus the zip, plus the repo source. The hub resolves the
 *  ref to a sha, clones at that pin, packs the folder, and publishes. */
export interface PublishFromRepoInput {
  publisher: PublishCatalogVersionInput["publisher"];
  item: PublishCatalogVersionInput["item"];
  version: PublishCatalogVersionInput["version"];
  repo: {
    url: string;
    ref?: string;
    subpath?: string;
  };
}

export interface PublishFromRepoResponse {
  itemId: string;
  version: string;
  resolvedSha: string;
  sourceUrl: string;
  bytes: number;
}

export function usePublishFromRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PublishFromRepoInput) =>
      adminApiFetch<PublishFromRepoResponse>("/admin/catalog/publish-from-repo", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminCatalogKeys.all }),
  });
}
