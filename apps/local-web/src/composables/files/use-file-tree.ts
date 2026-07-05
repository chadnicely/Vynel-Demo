import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";

/** One directory listing row from the files tree — derived from the SDK return
 * shape (no named schema export exists; the entry type is inline in `operations`). */
export type DirectoryEntry = Awaited<
  ReturnType<VynelClient["files"]["tree"]>
>["entries"][number];

export function useFileTree(
  workspaceId: MaybeRefOrGetter<string>,
  path: MaybeRefOrGetter<string | undefined>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => [
      "files",
      "tree",
      toValue(workspaceId),
      toValue(path) ?? "<root>",
    ]),
    queryFn: () => {
      const relativePath = toValue(path);
      return vynel.files.tree(
        toValue(workspaceId),
        relativePath ? { path: relativePath } : undefined,
      );
    },
    select: (response) => response.entries,
    enabled,
  });
}
