import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminCatalogKeys } from "./catalog-keys.js";

/** The wire shape of POST /admin/catalog/publish — PublishItemSchema
 *  (packages/registry/src/publish-input.ts) plus the base64 artifact. */
export interface PublishCatalogVersionInput {
  publisher: {
    id: string;
    name: string;
    tier: "verified" | "community";
    url: string | null;
  };
  item: {
    itemId: string;
    kind: "skill" | "agent" | "mcp" | "rule" | "plugin";
    displayName: string;
    oneLineDescription: string;
    category: string;
    iconName: string;
    recommendedScope: "user" | "workspace" | "both" | null;
    minimumTier: "basic" | "pro";
    status: "draft" | "published" | "yanked";
  };
  version: {
    version: string;
    changelog: string;
    manifest: Record<string, unknown>;
    minAppVersion: string | null;
  };
  artifactBase64: string;
}

export function usePublishCatalogVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PublishCatalogVersionInput) =>
      adminApiFetch<{ itemId: string; version: string }>(
        "/admin/catalog/publish",
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminCatalogKeys.all }),
  });
}
