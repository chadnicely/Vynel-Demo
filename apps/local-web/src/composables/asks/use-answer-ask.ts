import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { AskAnswers } from "@vynel/contracts/asks/ask-questions";
import { useVynel } from "../use-vynel.js";
import { askKeys } from "./ask-keys.js";

export function useAnswerAsk() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { askId: string; answers: AskAnswers }) =>
      vynel.asks.answer(input.askId, { answers: input.answers }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: askKeys.all }),
  });
}
