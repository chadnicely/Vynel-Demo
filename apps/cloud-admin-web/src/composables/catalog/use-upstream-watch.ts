import { useQuery } from "@tanstack/vue-query";
import { adminApiFetch } from "../../lib/admin-api.js";
import { adminCatalogKeys } from "./catalog-keys.js";

/** The hub's upstream-drift cron report (anthropics/skills vs our pin) —
 *  drives the catalog page's drift banner. `configured: false` = the hub
 *  runs without the manifest (nothing to watch). */
export type UpstreamWatchResponse = {
  configured: boolean;
  report?: {
    checkedAt: string;
    pinnedSha: string;
    upstreamHeadSha: string;
    upToDate: boolean;
    movedCount: number;
    items: Array<{ itemId: string; version: string; changed: boolean }>;
    repinRecipe: string | null;
  } | null;
  lastError?: string | null;
  lastRunAt?: string | null;
};

export function useUpstreamWatch() {
  return useQuery({
    queryKey: adminCatalogKeys.upstreamWatch(),
    queryFn: () => adminApiFetch<UpstreamWatchResponse>("/admin/upstream-watch"),
    // The hub re-checks daily; the portal doesn't need to poll faster.
    staleTime: 5 * 60 * 1000,
  });
}
