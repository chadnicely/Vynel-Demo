import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useVynel } from "../use-vynel.js";
import { askKeys } from "./ask-keys.js";

// Dismiss = "proceed without me": the turn resumes with no answers.
export function useDismissAsk() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (askId: string) => vynel.asks.dismiss(askId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: askKeys.all }),
  });
}
