import { reactive } from "vue";
import { defineStore } from "pinia";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import {
  applyChatTurnEvent,
  createActiveTurnView,
} from "../composables/chat/active-turn-view.js";
import type { ActiveTurnView } from "../composables/chat/active-turn-view.js";

// The realtime registry: every session streaming ANYWHERE (delegated
// workspace runs, agent runs) folds its events here, keyed by session id.
// The session viewer — and any message's "watch live" chip — reads it.
// When the real SSE session streams land, their readers ingest here the
// same way the demo players do.
export const useLiveSessionsStore = defineStore("live-sessions", () => {
  const views = reactive(new Map<string, ActiveTurnView>());

  function begin(sessionId: string) {
    views.set(sessionId, createActiveTurnView());
  }

  function ingest(sessionId: string, event: ChatTurnEvent) {
    const current = views.get(sessionId);
    if (!current) return;
    views.set(sessionId, applyChatTurnEvent(current, event));
  }

  function end(sessionId: string) {
    views.delete(sessionId);
  }

  function liveFor(sessionId: string): ActiveTurnView | null {
    return views.get(sessionId) ?? null;
  }

  return { views, begin, ingest, end, liveFor };
});
