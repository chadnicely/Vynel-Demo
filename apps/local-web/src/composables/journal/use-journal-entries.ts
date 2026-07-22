import { type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { journalKeys } from "./journal-keys.js";

export function useJournalEntries(enabled: MaybeRefOrGetter<boolean>) {
  const vynel = useVynel();
  return useQuery({
    queryKey: journalKeys.list(),
    queryFn: () => vynel.journalUser.list(),
    enabled,
  });
}
