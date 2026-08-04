import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { ActivitySource } from "../composables/activity/use-activity-monitor.js";

// The ONE activity panel's drill-down stack (sessions-surface Slice ②, deepened
// by the watch-pipeline drill): `Trace → Session → Agent` as a stack of nodes —
// Back pops, Close clears. An agent node CARRIES its parent's ActivitySource:
// its data is the live agentActivity map or the Agent call's persisted subagent
// fields, so it needs no channel of its own — which is what makes a direct-open
// agent (a thread card's Watch chip, no surrounding panel) watchable at all.
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
  /** The source the panel's single monitor binds to — the TOP node's (an agent
   *  node contributes the source it carries, so focusing an agent never
   *  re-binds). Was the bottom node's until the pipeline drill let a session
   *  node stack ON TOP of a trace — the drilled-into session needs its own
   *  channel, so the monitor follows the active node down the pipeline. */
  const activeSource = computed<ActivitySource | null>(() => {
    const top = stack.value.at(-1);
    return top === undefined ? null : sourceOf(top);
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

  /** A report chip / in-flight banner chip — watch a delegation's trace.
   *  While the panel is OPEN the click can only come from inside it (the
   *  scrim blocks everything behind) — a trace chip on the live session
   *  pane's thread (B6) — so the trace stacks on top and Back returns. */
  function openTrace(partialSessionId: string) {
    const node = { kind: "trace", partialSessionId } as const;
    if (isOpen.value) push(node);
    else open(node);
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

  /** A thread card's Watch chip — straight onto one agent. From a thread
   *  BEHIND the closed panel there's no context to return to (Close only, no
   *  Back); fired while the panel is open it can only be the live session
   *  pane's own thread (B6 — the scrim blocks everything else), so the agent
   *  stacks on top and Back returns to the conversation. The source is
   *  whatever channel carries the agent's activity: a delegation-traced row's
   *  trace, or — for a DIRECT turn's agent — the session the turn ran on (its
   *  persisted subagent fields live in that transcript). */
  function openAgentDirect(source: ActivitySource, toolUseId: string) {
    const node = { kind: "agent", source, toolUseId } as const;
    if (isOpen.value) push(node);
    else open(node);
  }

  /** Drill into an agent FROM the open panel — Back returns to it. The agent
   *  captures the ACTIVE node's source (a drilled-into session's agents read
   *  the session channel, not the trace the drill came through). */
  function focusAgent(toolUseId: string) {
    const source = activeSource.value;
    if (source === null) return;
    push({ kind: "agent", source, toolUseId });
  }

  return {
    stack,
    current,
    isOpen,
    backAvailable,
    activeSource,
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
