import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { DisplayWidgetView } from "@vynel/contracts/display/display-widget";
import { useVynel } from "../use-vynel.js";
import { displayWidgetKeys } from "./display-widget-keys.js";

// Taking one card off the board — the × on every widget frame.
//
// The card goes on the click, not on the server's `removed` frame. The frame
// normally lands in the same breath, but it rides the live socket: with the
// socket down the POST still succeeds and NOTHING would move on screen, so
// the × would read as broken exactly when the room is least trustworthy.
// Dropping the id from every cached board is exact rather than a guess — a
// widget id is unique across scopes — and the frame that follows filters the
// same id out of an already-filtered list.
//
// The rollback is a re-read, not a snapshot: the board may have moved on for
// other reasons while the request was in flight, and only the server knows.
export function useRemoveDisplayWidget() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (widgetId: string) => vynel.display.removeWidget(widgetId),
    onMutate: (widgetId) => {
      queryClient.setQueriesData<DisplayWidgetView[]>(
        { queryKey: displayWidgetKeys.all },
        (board) => board?.filter((card) => card.id !== widgetId),
      );
    },
    onError: () => queryClient.invalidateQueries({ queryKey: displayWidgetKeys.all }),
  });
}
