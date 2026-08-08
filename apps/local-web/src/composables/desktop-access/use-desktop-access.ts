import { type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { desktopAccessKeys } from "./desktop-access-keys.js";

/** One desktop app grant on the wire (the `/desktop/access` route's shape). */
export type DesktopAppGrant = {
  id: string;
  appName: string;
  tier: "read" | "click" | "full";
  createdAt: string;
  updatedAt: string;
};

/** The desktop apps the user has granted Claude access to. Grants appear when
 *  the user approves a request card mid-turn, so the section refreshes on a
 *  short interval while it is on screen. */
export function useDesktopAccess(enabled: MaybeRefOrGetter<boolean>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: desktopAccessKeys.list,
    queryFn: async () => (await vynel.desktopAccess.list()) as DesktopAppGrant[],
    enabled,
    refetchInterval: 15_000,
  });
}
