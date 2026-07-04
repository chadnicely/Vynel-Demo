import { computed, ref } from "vue";
import { defineStore } from "pinia";

// Cross-view liveness: the titlebar presence dot (and later the Home
// dashboard + Jarvis overlay) read this to show "the assistant is working"
// no matter which view started the turn.
export const useActivityStore = defineStore("activity", () => {
  const runningTurnCount = ref(0);

  const isTurnRunning = computed(() => runningTurnCount.value > 0);

  function turnStarted() {
    runningTurnCount.value += 1;
  }

  function turnEnded() {
    runningTurnCount.value = Math.max(0, runningTurnCount.value - 1);
  }

  return { runningTurnCount, isTurnRunning, turnStarted, turnEnded };
});
