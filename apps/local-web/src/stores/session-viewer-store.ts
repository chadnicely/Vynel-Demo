import { computed, ref } from "vue";
import { defineStore } from "pinia";

// The right-side delegation-trace viewer: holds the partialSessionId of the
// delegation being watched (opened from a report message's "Watch X" chip), or
// null when closed. A delegation trace is flat (task → reply → report), so there
// is no drill-down — just open one and close.
export const useSessionViewerStore = defineStore("session-viewer", () => {
  const currentSessionId = ref<string | null>(null);
  const isOpen = computed(() => currentSessionId.value !== null);

  function open(partialSessionId: string) {
    currentSessionId.value = partialSessionId;
  }

  function close() {
    currentSessionId.value = null;
  }

  return { currentSessionId, isOpen, open, close };
});
