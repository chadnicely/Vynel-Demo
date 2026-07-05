import { computed, ref } from "vue";
import { defineStore } from "pinia";

// The right-side session viewer's navigation: a stack of session ids.
// Opening from a chat link starts a fresh stack; opening from INSIDE the
// viewer drills down (Back pops). Close clears everything.
export const useSessionViewerStore = defineStore("session-viewer", () => {
  const stack = ref<string[]>([]);

  const isOpen = computed(() => stack.value.length > 0);
  const currentSessionId = computed(
    () => stack.value[stack.value.length - 1] ?? null,
  );
  const canGoBack = computed(() => stack.value.length > 1);

  /** Open from a chat surface: fresh stack. No-op if already showing it. */
  function open(sessionId: string) {
    if (currentSessionId.value === sessionId) return;
    stack.value = [sessionId];
  }

  /** Drill down from inside the viewer: push, Back returns. */
  function drillDown(sessionId: string) {
    if (currentSessionId.value === sessionId) return;
    stack.value = [...stack.value, sessionId];
  }

  function back() {
    stack.value = stack.value.slice(0, -1);
  }

  function close() {
    stack.value = [];
  }

  return {
    stack,
    isOpen,
    currentSessionId,
    canGoBack,
    open,
    drillDown,
    back,
    close,
  };
});
