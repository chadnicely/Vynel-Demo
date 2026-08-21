import {
  computed,
  onScopeDispose,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { liveChannelKeys } from "@vynel/contracts/chat/live-channel";
import type { DisplayLiveFrame } from "@vynel/contracts/display/display-live";
import type { DisplayWidgetView } from "@vynel/contracts/display/display-widget";
import {
  DISPLAY_WIDGET_SLOTS,
  type DisplayWidgetSlot,
} from "@vynel/contracts/display/display-widget-content";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import { useVynel } from "../use-vynel.js";
import { displayWidgetKeys } from "./display-widget-keys.js";

// One scope's board, kept current WHILE Claude talks: the HTTP list is the
// truth on arrival, and the per-user `display` live channel patches it from
// there. The channel is per user rather than per scope, so every frame is
// filtered against the scope this instance shows — a widget Claude put on a
// workspace's board must never surface on the global one.
//
// The cache stays ONE flat list; `bySlot` is derived. Materialised buckets
// would strand a widget in its old slot the moment an update moved it.

export type DisplayWidgetsBySlot = Record<DisplayWidgetSlot, DisplayWidgetView[]>;

/** What a live frame MEANT for this board, in the words a reader uses. An
 *  `upserted` frame is an ADD or an EDIT depending on what the board already
 *  held, and a `removed` frame names its card only while that card is still
 *  there — both are knowable here and nowhere else, which is why the notice is
 *  built rather than the raw frame handed on. */
export type DisplayBoardChangeKind = "added" | "updated" | "removed" | "cleared";

export interface DisplayBoardChange {
  readonly kind: DisplayBoardChangeKind;
  /** null when the frame names no single card (`cleared`), or when the board
   *  had not been read yet and the id could not be resolved. */
  readonly title: string | null;
}

export interface DisplayWidgetsOptions {
  /** A tap on the live stream so a caller can narrate the board — the room's
   *  telemetry log rides this rather than opening a SECOND `display`
   *  subscription over the same socket. */
  onChange?: (change: DisplayBoardChange) => void;
}

export interface DisplayWidgets {
  /** The scope's cards, unordered — read `bySlot` to lay them out. */
  readonly widgets: ComputedRef<DisplayWidgetView[]>;
  /** Every slot, always present, each sorted by `sortOrder` ascending. */
  readonly bySlot: ComputedRef<DisplayWidgetsBySlot>;
  readonly isLoading: Ref<boolean>;
  /** Blank the board LOCALLY — the optimistic half of the "Clear" affordance.
   *  The caller still posts `/display/clear`; without that the next read
   *  brings every card back. Idempotent: the server's own `cleared` frame
   *  lands on an already-empty list. */
  clear: () => void;
  /** Blank the board FOR REAL — the whole of the "Clear" affordance: the
   *  optimistic local blank AND the POST that makes it true. It lives with the
   *  board because clearing is bound to the SCOPE this instance reads; a
   *  caller doing it itself would have to carry that scope to a second door
   *  and keep the two halves in step by hand. Rejects if the POST failed, its
   *  board already put back. */
  clearOnServer: () => Promise<void>;
}

/** Which scope a frame is about — `upserted` carries it on the widget, the
 *  other two at the top level. */
function frameScopeKey(frame: DisplayLiveFrame): string {
  return frame.kind === "upserted" ? frame.widget.scopeKey : frame.scopeKey;
}

function applyFrame(
  board: DisplayWidgetView[],
  frame: DisplayLiveFrame,
): DisplayWidgetView[] {
  switch (frame.kind) {
    case "upserted":
      return [...board.filter((card) => card.id !== frame.widget.id), frame.widget];
    case "removed":
      return board.filter((card) => card.id !== frame.widgetId);
    case "cleared":
      return [];
  }
}

/** What a frame changed, read against the board as it stands BEFORE the patch. */
function describeFrame(
  board: DisplayWidgetView[] | undefined,
  frame: DisplayLiveFrame,
): DisplayBoardChange {
  switch (frame.kind) {
    case "upserted":
      return {
        // With no board read yet nothing can have been updated — and a card
        // arriving on an unread board reads as "added" either way.
        kind: board?.some((card) => card.id === frame.widget.id) ? "updated" : "added",
        title: frame.widget.title,
      };
    case "removed":
      return {
        kind: "removed",
        title: board?.find((card) => card.id === frame.widgetId)?.title ?? null,
      };
    case "cleared":
      return { kind: "cleared", title: null };
  }
}

export function useDisplayWidgets(
  scope: MaybeRefOrGetter<string>,
  options: DisplayWidgetsOptions = {},
): DisplayWidgets {
  const vynel = useVynel();
  const live = useLiveChannelStore();
  const queryClient = useQueryClient();

  const scopeKey = computed(() => toValue(scope));
  const query = useQuery({
    queryKey: computed(() => displayWidgetKeys.scope(scopeKey.value)),
    // Annotated with the CONTRACT type the live frames also carry: if the
    // route's generated shape ever drifts from `DisplayWidgetView`, the two
    // halves of this board stop compiling instead of quietly disagreeing.
    queryFn: async (): Promise<DisplayWidgetView[]> =>
      vynel.display.listWidgets({ scope: scopeKey.value }),
  });

  // Anything learned WHILE a read is in flight is lost to that read: its
  // answer describes the board as of when it was ISSUED, and it overwrites
  // whatever was patched meanwhile. So note it and re-read once it settles.
  // (Invalidating on the spot cannot stand in for this: a query's FIRST fetch
  // ignores `cancelRefetch` and simply hands back the promise in flight.)
  let staleAfterInFlightRead = false;
  function reReadAfterInFlightRead(): void {
    if (query.isFetching.value) staleAfterInFlightRead = true;
  }
  watch(
    () => query.isFetching.value,
    (isFetching) => {
      if (isFetching || !staleAfterInFlightRead) return;
      staleAfterInFlightRead = false;
      void query.refetch();
    },
    // Sync so no frame can slip into the gap between the settle and the
    // follow-up read being issued.
    { flush: "sync" },
  );

  function absorbFrame(frame: DisplayLiveFrame): void {
    const key = displayWidgetKeys.scope(scopeKey.value);
    const board = queryClient.getQueryData<DisplayWidgetView[]>(key);
    // No board yet: the very first read has not answered, and one card is not
    // a board — there is nothing to patch here, only something to re-read.
    if (board === undefined) {
      staleAfterInFlightRead = true;
      return;
    }
    reReadAfterInFlightRead();
    queryClient.setQueryData<DisplayWidgetView[]>(key, applyFrame(board, frame));
  }

  let hadSubscribed = false;
  const release = live.subscribe(liveChannelKeys.display, {
    onEvent: (raw) => {
      const frame = raw as DisplayLiveFrame;
      if (frameScopeKey(frame) !== scopeKey.value) return;
      options.onChange?.(
        describeFrame(
          queryClient.getQueryData<DisplayWidgetView[]>(
            displayWidgetKeys.scope(scopeKey.value),
          ),
          frame,
        ),
      );
      absorbFrame(frame);
    },
    onSubscribed: () => {
      // A re-ack means the socket dropped and came back: frames in the gap are
      // gone for good, so the board on screen is stale until it is read again.
      // `all`, not this scope — EVERY board this window cached went stale in
      // that gap, not only the one on screen.
      if (hadSubscribed) {
        reReadAfterInFlightRead();
        void queryClient.invalidateQueries({ queryKey: displayWidgetKeys.all });
      }
      hadSubscribed = true;
    },
  });
  onScopeDispose(release);

  const widgets = computed(() => query.data.value ?? []);
  const bySlot = computed<DisplayWidgetsBySlot>(() => {
    const buckets = Object.fromEntries(
      DISPLAY_WIDGET_SLOTS.map((slot) => [slot, [] as DisplayWidgetView[]]),
    ) as DisplayWidgetsBySlot;
    for (const widget of widgets.value) buckets[widget.slot].push(widget);
    for (const slot of DISPLAY_WIDGET_SLOTS) {
      buckets[slot].sort((left, right) => left.sortOrder - right.sortOrder);
    }
    return buckets;
  });

  // No board yet = nothing on screen to blank, and seeding an empty one would
  // race the read in flight.
  function clear(): void {
    queryClient.setQueryData<DisplayWidgetView[]>(
      displayWidgetKeys.scope(scopeKey.value),
      (board) => (board === undefined ? undefined : []),
    );
  }

  async function clearOnServer(): Promise<void> {
    const key = displayWidgetKeys.scope(scopeKey.value);
    clear();
    try {
      await vynel.display.clear({ scope: scopeKey.value });
    } catch (error) {
      // The board on screen is now a lie — put the truth back before handing
      // the failure on, so the caller's message and the board agree.
      void queryClient.invalidateQueries({ queryKey: key });
      throw error;
    }
  }

  return { widgets, bySlot, isLoading: query.isLoading, clear, clearOnServer };
}
