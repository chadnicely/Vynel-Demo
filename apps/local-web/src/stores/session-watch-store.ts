import { computed, ref } from "vue";
import { defineStore } from "pinia";

// The Sessions view's "watch this conversation live" overlay — which session
// (a REAL sdk session id, unlike the delegation viewer's correlation key) the
// panel is attached to, and the human label it wears.
export const useSessionWatchStore = defineStore("session-watch", () => {
  const sessionId = ref<string | null>(null);
  const title = ref("");
  const isOpen = computed(() => sessionId.value !== null);

  function open(id: string, label: string) {
    sessionId.value = id;
    title.value = label;
  }

  function close() {
    sessionId.value = null;
    title.value = "";
  }

  return { sessionId, title, isOpen, open, close };
});
