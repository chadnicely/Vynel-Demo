import { onScopeDispose } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";
import { liveChannelKeys } from "@vynel/contracts/chat/live-channel";
import { useActivityStore } from "../../stores/activity-store.js";
import { useDesktopActivityStore } from "../../stores/desktop-activity-store.js";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import { sessionKeys } from "../chat/session-keys.js";
import { workspaceKeys } from "../workspaces/workspace-keys.js";
import { approvalKeys } from "../approvals/approval-keys.js";
import { dashboardKeys } from "../dashboard/dashboard-keys.js";

// ONE `activity` subscription for the window's lifetime (AppShell / the
// desktop overlay mount it) on the window's ONE live socket. This is the UI's
// server push: turns started ANYWHERE — a Telegram message's background root
// turn, another window, a schedule fire — fold into the activity store, and
// the chat views go live while one runs in their scope. Each turn boundary
// also settles the session queries by invalidation, so a finished background
// turn surfaces without waiting for a poll tick.
//
// The socket reconnects on its own and re-subscribes; the server replays the
// in-flight snapshot on every (re)subscribe. Meanwhile the server-turn map
// resets (stale without a live socket), and after a gap one
// settle-invalidation covers whatever frames were missed.

export function useSessionActivityFeed() {
  const live = useLiveChannelStore();
  const activity = useActivityStore();
  const desktopActivity = useDesktopActivityStore();
  const queryClient = useQueryClient();

  let hadConnected = false;

  function settleSessionViews(event: SessionActivityEvent) {
    void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    // A finished global turn can have registered workspaces (the same rule
    // use-chat-turn applies after an own global turn).
    if (event.kind === "turn-ended") {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      // Overview + usage statistics both settle when a turn lands.
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    }
  }

  function onEvent(raw: unknown) {
    const event = raw as SessionActivityEvent;
    activity.applyServerActivity(event);
    desktopActivity.apply(event);
    if (
      event.kind === "turn-approval-requested" ||
      event.kind === "turn-approval-resolved"
    ) {
      // The bell says "the approval set changed NOW" — the 5s poll is too
      // slow while Claude is mid-drive on the user's desktop.
      void queryClient.invalidateQueries({ queryKey: approvalKeys.pending() });
    }
    if (event.kind === "turn-started" || event.kind === "turn-ended") {
      settleSessionViews(event);
    }
    // A context swap moved a conversation onto a fresh segment — the
    // sessions panel + continuing threads re-read their heads.
    if (event.kind === "turn-context-patched") {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    }
  }

  const release = live.subscribe(liveChannelKeys.activity, {
    onEvent,
    onSubscribed: () => {
      if (hadConnected) {
        // Frames may have been missed while disconnected — settle once.
        void queryClient.invalidateQueries({ queryKey: sessionKeys.all });
      }
      hadConnected = true;
    },
    onDetached: () => {
      activity.resetServerTurns();
      desktopActivity.reset();
    },
  });

  onScopeDispose(() => {
    release();
    activity.resetServerTurns();
    desktopActivity.reset();
  });
}
