// The thread's STANDING subscription to its displayed session's live channel —
// now a THIN ADAPTER over the multiplexed live-turn registry (persona-sessions
// B3): the registry owns the SSE + fold + seed + settle + re-attach loop (one
// connection per session no matter how many surfaces watch); this adapter
// keeps the caller-facing contract — the session getter, the suppression rule
// ("one turn never renders twice", applied at RENDER time — and, since the
// socket diet, also handed to the registry's attach gate so a suppressed-only
// watch holds no socket), and the caller's own detail query as the
// seed/settle snapshot provider.

import { computed, onScopeDispose, shallowRef, watch } from "vue";
import type { ActiveTurnView } from "./active-turn-view.js";
import {
  useLiveTurnRegistry,
  type LiveTurnSubscription,
  type WatchedTurnSnapshot,
} from "../../stores/live-turn-registry.js";

// The snapshot type's home moved to the registry with the loop — re-exported
// so existing callers keep their import path.
export type { WatchedTurnSnapshot } from "../../stores/live-turn-registry.js";

export function useWatchedTurn(options: {
  /** The session the thread displays — null detaches the watcher. The ONLY
   *  callback read synchronously (setup-time); the others fire async-only, so
   *  callers may close over consts declared after this composable call. */
  sessionId: () => string | null;
  /** True while the view's OWN turn overlay renders this thread — the shared
   *  fold keeps folding, but this adapter renders nothing (render-time
   *  suppression; the registry never discards). */
  isSuppressed: () => boolean;
  /** Fresh settled rows — the mid-turn seed and the turn-end settle. MUST
   *  reject on a failed fetch (TanStack's refetch resolves with `error`
   *  instead of throwing — the caller surfaces it). */
  refetchDetail: () => Promise<WatchedTurnSnapshot | undefined>;
}) {
  const registry = useLiveTurnRegistry();
  const subscription = shallowRef<LiveTurnSubscription | null>(null);

  watch(
    () => options.sessionId(),
    (sessionId) => {
      subscription.value?.release();
      subscription.value =
        sessionId === null
          ? null
          : registry.subscribe(
              { kind: "session", id: sessionId },
              {
                fetchSnapshot: options.refetchDetail,
                // The socket diet: a watch this consumer wouldn't render (its
                // own overlay is up) must not hold a connection by itself.
                isSuppressed: options.isSuppressed,
              },
            );
    },
    { immediate: true },
  );
  onScopeDispose(() => subscription.value?.release());

  // ACCEPTED window (B3 review): at the own turn's settle, suppression lifts
  // while the shared fold still holds the same (finished) turn until ITS
  // settle clears it — a brief flash of identical content, bounded by the
  // local API's settle round-trip. Suppressing through it would need the
  // registry to know whose turn ended; not worth the coupling.
  const view = computed<ActiveTurnView | null>(() =>
    options.isSuppressed() ? null : (subscription.value?.view.value ?? null),
  );
  // The shared channel's failure, said (B6) — the registry keeps retrying
  // session sources, so a host showing this gets an honest "live dropped"
  // line instead of a silently stale thread.
  const errorText = computed(
    () => subscription.value?.errorText.value ?? null,
  );
  return { view, errorText };
}
