import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";

export function useFileContent(
  workspaceId: MaybeRefOrGetter<string>,
  filePath: MaybeRefOrGetter<string>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => [
      "files",
      "content",
      toValue(workspaceId),
      toValue(filePath),
    ]),
    queryFn: () =>
      vynel.files.readContent(toValue(workspaceId), {
        path: toValue(filePath),
      }),
    enabled: computed(() => toValue(filePath).length > 0),
  });
}
