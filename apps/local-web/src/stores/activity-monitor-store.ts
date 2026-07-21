import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { ActivitySource } from "../composables/activity/use-activity-monitor.js";

// The ONE activity panel's drill-down stack (sessions-surface Slice ②):
// `Session → Session | Agent` as a stack of nodes — Back pops, Close clears.
// An agent node CARRIES its parent's ActivitySource: its data is the live
// agentActivity map or the Agent call's persisted subagent fields, so it needs
// no channel of its own — which is what makes a direct-open agent (a thread
// card's Watch chip, no surrounding panel) watchable at all.
export type ActivityNode =
  | { kind: "trace"; partialSessionId: string }
  | { kind: "session"; sessionId: string; title: string }
  | { kind: "agent"; source: ActivitySource; toolUseId: string };

function sourceOf(node: ActivityNode): ActivitySource {
  switch (node.kind) {
    case "trace":
      return { kind: "trace", id: node.partialSessionId };
    case "session":
      return { kind: "session", id: node.sessionId };
    case "agent":
      return node.source;
  }
}

export const useActivityMonitorStore = defineStore("activity-monitor", () => {
  const stack = ref<ActivityNode[]>([]);

  const current = computed<ActivityNode | null>(
    () => stack.value.at(-1) ?? null,
  );
  const isOpen = computed(() => stack.value.length > 0);
  const backAvailable = computed(() => stack.value.length > 1);
  /** The source the panel's single monitor binds to — the bottom node's (an
   *  agent bottom node contributes the source it carries). */
  const baseSource = computed<ActivitySource | null>(() => {
    const bottom = stack.value[0];
    return bottom === undefined ? null : sourceOf(bottom);
  });

  function open(node: ActivityNode) {
    stack.value = [node];
  }

  function push(node: ActivityNode) {
    stack.value = [...stack.value, node];
  }

  function back() {
    if (stack.value.length > 1) stack.value = stack.value.slice(0, -1);
  }

  function close() {
    stack.value = [];
  }

  /** A report chip / in-flight banner chip — watch a delegation's trace. */
  function openTrace(partialSessionId: string) {
    open({ kind: "trace", partialSessionId });
  }

  /** Watch any owned session in the panel, labeled by its identity. KEPT
   *  (Slice ④ decision) as the session-kind door the node stack builds on —
   *  thread chips hold a TRACE key (partialSessionId is a correlation key,
   *  not a session id) so they open `openTrace`; direct-agent chips enter via
   *  `openAgentDirect` with a session source. A surface holding a real
   *  session id (watch-from-list, if it returns) lands here. */
  function openSession(sessionId: string, title: string) {
    open({ kind: "session", sessionId, title });
  }

  /** A thread card's Watch chip — straight onto one agent, no panel context to
   *  return to: Close only, no Back. The source is whatever channel carries the
   *  agent's activity: a delegation-traced row's trace, or — for a DIRECT
   *  turn's agent — the session the turn ran on (its persisted subagent fields
   *  live in that transcript). */
  function openAgentDirect(source: ActivitySource, toolUseId: string) {
    open({ kind: "agent", source, toolUseId });
  }

  /** Drill into an agent FROM the open panel — Back returns to it. */
  function focusAgent(toolUseId: string) {
    const source = baseSource.value;
    if (source === null) return;
    push({ kind: "agent", source, toolUseId });
  }

  return {
    stack,
    current,
    isOpen,
    backAvailable,
    baseSource,
    open,
    push,
    back,
    close,
    openTrace,
    openSession,
    openAgentDirect,
    focusAgent,
  };
});
