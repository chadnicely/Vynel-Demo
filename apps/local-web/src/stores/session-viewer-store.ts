import { computed, ref } from "vue";
import { defineStore } from "pinia";

// The right-side trace viewer. Two levels now (the Phase-3 drill-down's first
// step): the delegation TRACE (opened from a report message's "Watch X" chip)
// and, within a trace, one spawned AGENT's focused view (opened from an Agent
// card's chip). `agentBackTarget` remembers whether the agent view was entered
// FROM the trace (global chat: Back returns to it) or directly from a thread's
// card (workspace chat: no trace context — Back hidden, Close only).
export const useSessionViewerStore = defineStore("session-viewer", () => {
  const currentSessionId = ref<string | null>(null);
  /** The Agent tool call the panel is focused on — null = the full trace. */
  const focusedAgentToolUseId = ref<string | null>(null);
  /** True when Back should return to the trace view (entered by drill-in). */
  const agentBackAvailable = ref(false);
  const isOpen = computed(() => currentSessionId.value !== null);

  function open(partialSessionId: string) {
    currentSessionId.value = partialSessionId;
    focusedAgentToolUseId.value = null;
    agentBackAvailable.value = false;
  }

  /** Open straight onto one agent (a thread card's chip) — no trace to go
   *  back to, so the panel shows Close only. */
  function openAgent(partialSessionId: string, agentToolUseId: string) {
    currentSessionId.value = partialSessionId;
    focusedAgentToolUseId.value = agentToolUseId;
    agentBackAvailable.value = false;
  }

  /** Drill into an agent FROM the open trace — Back returns to it. */
  function focusAgent(agentToolUseId: string) {
    if (currentSessionId.value === null) return;
    focusedAgentToolUseId.value = agentToolUseId;
    agentBackAvailable.value = true;
  }

  /** The agent view's Back — return to the full trace. */
  function clearAgentFocus() {
    focusedAgentToolUseId.value = null;
    agentBackAvailable.value = false;
  }

  function close() {
    currentSessionId.value = null;
    focusedAgentToolUseId.value = null;
    agentBackAvailable.value = false;
  }

  return {
    currentSessionId,
    focusedAgentToolUseId,
    agentBackAvailable,
    isOpen,
    open,
    openAgent,
    focusAgent,
    clearAgentFocus,
    close,
  };
});
