import { useQuery } from "@tanstack/vue-query";
import type { LocalModelsResponse } from "@vynel/contracts/models/local-models-http";
import { useVynel } from "../use-vynel.js";
import { localModelKeys } from "./local-model-keys.js";

const DOWNLOADING_POLL_MS = 1_000;
const SETTLED_POLL_MS = 30_000;

/** The local models on this computer with their state. A download runs in the
 *  background and the row carries its bytes, so the poll tightens while
 *  anything is downloading and relaxes once everything has settled. */
export function useLocalModels() {
  const vynel = useVynel();
  return useQuery({
    queryKey: localModelKeys.list,
    queryFn: async () => ((await vynel.localModels.list()) as LocalModelsResponse).models,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((model) => model.state === "downloading")
        ? DOWNLOADING_POLL_MS
        : SETTLED_POLL_MS,
  });
}
