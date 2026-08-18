import { ref } from "vue";
import { defineStore } from "pinia";
import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";
import {
  applyDesktopActivityEvent,
  emptyDesktopActivity,
  type DesktopActivityState,
} from "./desktop-activity-fold.js";

// What Claude is doing to the DESKTOP right now — fed by the same
// activity subscription (the live channel) as the activity store (the feed composable
// applies every event to both). The desktop-control overlay window reads this;
// the fold itself is pure (desktop-activity-fold.ts).
export const useDesktopActivityStore = defineStore("desktop-activity", () => {
  const state = ref<DesktopActivityState>(emptyDesktopActivity());

  function apply(event: SessionActivityEvent) {
    state.value = applyDesktopActivityEvent(state.value, event, Date.now());
  }

  /** The feed dropped — stale narration must not float over the desktop. */
  function reset() {
    state.value = emptyDesktopActivity();
  }

  return { state, apply, reset };
});
