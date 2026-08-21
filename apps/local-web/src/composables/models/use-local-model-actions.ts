import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { invalidateLocalModels } from "./local-model-keys.js";

/** Download / cancel / remove one local model. Each returns as soon as the
 *  engine has taken the request — the list poll shows what follows. */
export function useLocalModelActions() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  const onSettled = () => invalidateLocalModels(queryClient);
  return {
    download: useMutation({
      mutationFn: (modelId: string) => vynel.localModels.download(modelId),
      onSettled,
    }),
    cancel: useMutation({
      mutationFn: (modelId: string) => vynel.localModels.cancelDownload(modelId),
      onSettled,
    }),
    remove: useMutation({
      mutationFn: (modelId: string) => vynel.localModels.remove(modelId),
      onSettled,
    }),
  };
}
