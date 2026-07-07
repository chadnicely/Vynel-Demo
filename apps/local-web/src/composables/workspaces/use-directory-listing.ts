import { computed, type Ref } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { workspaceKeys } from "./workspace-keys.js";

/** The folder-picker read: `path === null` lists the user's home directory
 *  (the API's default). keepPreviousData keeps the panel steady while the
 *  next directory loads — no flash on every click. */
export function useDirectoryListing(
  path: Ref<string | null>,
  enabled: Ref<boolean>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => workspaceKeys.directories(path.value)),
    queryFn: () =>
      vynel.workspaces.listDirectories(
        path.value === null ? undefined : { path: path.value },
      ),
    placeholderData: keepPreviousData,
    enabled,
  });
}
