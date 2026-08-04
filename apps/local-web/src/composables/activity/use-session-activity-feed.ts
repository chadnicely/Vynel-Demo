import { onScopeDispose } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";
import { useVynel } from "../use-vynel.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useDesktopActivityStore } from "../../stores/desktop-activity-store.js";
import { useTurnNarrationStore } from "../../stores/turn-narration-store.js";
import { sessionKeys } from "../chat/session-keys.js";
import { workspaceKeys } from "../workspaces/workspace-keys.js";
import { approvalKeys } from "../approvals/approval-keys.js";
import { dashboardKeys } from "../dashboard/dashboard-keys.js";
import { readSessionActivityEvents } from "./session-activity-stream.js";

// ONE long-lived /activity/stream subscription for the app's lifetime (AppShell
// mounts it). This is the UI's only server push: turns started ANYWHERE — a
// Telegram message's background root turn, another tab, a schedule fire — fold
// into the activity store, and the chat views poll their thread live while one
// runs in their scope (rows persist per chunk, so polled text is near-live).
// Each turn boundary also settles the session queries by invalidation, so a
// finished background turn surfaces without waiting for a poll tick.
//
// Reconnects with backoff on any drop; the server-turn map resets meanwhile
// (stale without a live feed) and the next attach replays the snapshot. After
// a gap, one settle-invalidation covers whatever frames were missed.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

export function useSessionActivityFeed() {
  const vynel = useVynel();
  const activity = useActivityStore();
  const desktopActivity = useDesktopActivityStore();
  const narration = useTurnNarrationStore();
  const queryClient = useQueryClient();

  let disposed = false;
  let abortController: AbortController | null = null;

  function settleSessionViews(event: SessionActivityEvent) {
    void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    // A finished global turn can have registered workspaces (the same rule
    // use-chat-turn applies after an own global turn).
    if (event.kind === "turn-ended") {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      // Overview + usage statistics both settle when a turn lands.
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      // The Background roster's durable seed would otherwise ghost the ended
      // turn until its next poll tick (free while the roster is closed —
      // disabled queries just mark stale).
      void queryClient.invalidateQueries({ queryKey: ["activity", "running"] });
    }
  }

  async function run() {
    let attempt = 0;
    let hadConnected = false;
    while (!disposed) {
      abortController = new AbortController();
      try {
        const { data, response } = await vynel.GET("/activity/stream", {
          parseAs: "stream",
          signal: abortController.signal,
        });
        if (!response.ok || !data)
          throw new Error(`activity stream refused (${response.status})`);
        attempt = 0;
        if (hadConnected) {
          // Frames may have been missed while disconnected — settle once.
          void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
        }
        hadConnected = true;
        for await (const event of readSessionActivityEvents(data)) {
          activity.applyServerActivity(event);
          desktopActivity.apply(event);
          narration.apply(event);
          if (
            event.kind === "turn-approval-requested" ||
            event.kind === "turn-approval-resolved"
          ) {
            // The bell says "the approval set changed NOW" — the 5s poll is too
            // slow while Claude is mid-drive on the user's desktop.
            void queryClient.invalidateQueries({
              queryKey: approvalKeys.pending(),
            });
          }
          if (event.kind === "turn-started" || event.kind === "turn-ended") {
            settleSessionViews(event);
          }
        }
        // The server closed (shutdown/restart) — fall through and reconnect.
      } catch {
        // Dropped, refused, or aborted by dispose — the loop below carries the
        // retry; the disposed flag is the clean exit.
      }
      activity.resetServerTurns();
      desktopActivity.reset();
      narration.reset();
      if (disposed) break;
      attempt += 1;
      const delayMs = Math.min(
        RECONNECT_BASE_MS * 2 ** (attempt - 1),
        RECONNECT_MAX_MS,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  void run();
  onScopeDispose(() => {
    disposed = true;
    abortController?.abort();
    activity.resetServerTurns();
    desktopActivity.reset();
    narration.reset();
  });
}
