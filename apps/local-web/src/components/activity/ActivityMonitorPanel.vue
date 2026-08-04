<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useActivityMonitor } from "../../composables/activity/use-activity-monitor.js";
import { useStopDelegation } from "../../composables/delegations/use-stop-delegation.js";
import { collapseTraceEcho } from "../../composables/delegations/collapse-trace-echo.js";
import { useActivityMonitorStore } from "../../stores/activity-monitor-store.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import { deriveAgentFocus } from "./agent-focus.js";
import ActivityEntriesList from "./ActivityEntriesList.vue";
import ActivityPanelHeader from "./ActivityPanelHeader.vue";
import AgentFocusView from "./AgentFocusView.vue";
import LiveSessionPane from "./LiveSessionPane.vue";

// The ONE activity overlay (sessions-surface Slice ②) — the old delegation
// viewer and session watch panels merged over the single monitor seam, with
// the node-stack drill-down, now the full watch PIPELINE (Chad's 2026-07-21
// scoping rules): `Trace → Session → Agent`, Back walking up. ONE monitor
// binds to the stack's ACTIVE source (a drilled-into session brings its own
// channel); an agent node reads that monitor's live map or the Agent call's
// persisted fields — no channel of its own.
const store = useActivityMonitorStore();

const {
  entries,
  agentActivity,
  pendingApprovalToolName,
  isStreaming,
  hasEnded,
  errorText,
  turnError,
  traceQuery,
} = useActivityMonitor(() => store.activeSource);

const activeKind = computed(() => store.activeSource?.kind ?? null);
const agentNode = computed(() =>
  store.current?.kind === "agent" ? store.current : null,
);
// A SESSION node renders the real conversation (LiveSessionPane, B6) instead
// of the entries list — full transcript, live overlay, and the direct-send
// composer where the scope allows it. The monitor keeps running for the
// header (its registry subscription is shared with the pane's — one stream).
const sessionPaneNode = computed(() =>
  store.current?.kind === "session" ? store.current : null,
);

// The workspace reply and the surfaced global report carry the SAME body — the
// backend trace is deliberately faithful (both copies returned); display
// collapses the echo for trace nodes (see collapse-trace-echo.ts).
const displayEntries = computed(() =>
  activeKind.value === "trace"
    ? collapseTraceEcho(entries.value)
    : entries.value,
);

// ── Trace-kind job affordances (status pill + Stop) ──
const status = computed(() =>
  activeKind.value === "trace" ? (traceQuery.data.value?.status ?? null) : null,
);
const isWorking = computed(
  () => status.value === "pending" || status.value === "claimed",
);

// The user's Stop for the watched task — visible only while it runs. The
// route fails a queued job outright and interrupts a running one; the trace
// poll then settles the panel to "Failed (stopped by the user)".
const stopDelegation = useStopDelegation();
function stopWatchedTask() {
  const source = store.activeSource;
  if (source?.kind === "trace") stopDelegation.mutate(source.id);
}

// ── The pipeline drill (trace → session) ──
// A SESSION-target trace names the spawned session it ran in; its report
// entries offer a drill into that session's node — Back returns to the trace.
const sessionDrill = computed(() => {
  if (activeKind.value !== "trace") return null;
  const target = traceQuery.data.value?.spawnedTargetSession ?? null;
  return target === null
    ? null
    : { sessionId: target.sessionId, title: target.name };
});

function drillIntoSession() {
  const drill = sessionDrill.value;
  if (drill === null) return;
  store.push({ kind: "session", sessionId: drill.sessionId, title: drill.title });
}

const statusLabel = computed(() => {
  switch (status.value) {
    case "pending":
      return "Queued…";
    case "claimed":
      return "Working…";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return "";
  }
});

// The pill's tone: gold while alive, quiet green when settled well, danger red
// when the job failed — the panel's state readable at a glance.
const statusTone = computed(() => {
  if (isWorking.value) return "live" as const;
  if (status.value === "completed") return "ok" as const;
  if (status.value === "failed") return "danger" as const;
  return null;
});

// ── Focused agent (an agent node on top of the stack) ──
const agentFocus = computed(() =>
  agentNode.value === null
    ? null
    : deriveAgentFocus(entries.value, agentActivity.value, agentNode.value.toolUseId),
);

// ── Header pieces follow the current node so the template stays one shape ──
// The first labelled entry names the delegated workspace/manager (e.g. "Noah · vynel").
const traceTitle = computed(
  () =>
    entries.value.find((entry) => entry.sourceLabel)?.sourceLabel ??
    "Delegation",
);

const headerTitle = computed(() => {
  if (agentFocus.value !== null) return `Agent ${agentFocus.value.name}`;
  const node = store.current;
  if (node?.kind === "session") return node.title;
  if (node?.kind === "trace") return traceTitle.value;
  return "";
});

const headerLive = computed(() => {
  if (agentFocus.value !== null)
    return agentFocus.value.call?.status === "started";
  return activeKind.value === "trace" ? isWorking.value : isStreaming.value;
});

const headerContext = computed(() => {
  if (agentFocus.value !== null)
    return (
      agentFocus.value.task ??
      "Watching this agent live — everything it does shows up here."
    );
  return activeKind.value === "trace"
    ? "Watching this task live — everything the workspace does shows up here."
    : "Watching this conversation live — replies and tool use show up here as they happen.";
});

// Back names where it GOES — the node UNDER the top of the stack (the pipeline
// drill can leave a trace beneath a session beneath an agent).
const backLabel = computed(() => {
  const below = store.stack.at(-2);
  if (below === undefined) return "Back";
  return below.kind === "trace" ? "Back to the task" : "Back to the conversation";
});

// Each kind keeps its established error surface: a trace fails through its
// settled read (polling was always its fallback); a session says a stream drop.
const bodyErrorText = computed(() => {
  // B2: a TURN that ended in session-errored is said first — the full fold
  // carries it now (the old panel fold silently ate it).
  if (turnError.value !== null) {
    return `The turn errored (${turnError.value.code}): ${turnError.value.message}`;
  }
  return activeKind.value === "trace"
    ? traceQuery.isError.value
      ? formatSdkError(traceQuery.error.value)
      : null
    : errorText.value;
});

function onKeydown(event: KeyboardEvent) {
  // An inner overlay (e.g. the new-workspace dialog) that handled this press
  // claims it via preventDefault — only the topmost overlay closes.
  if (event.defaultPrevented) return;
  if (event.key === "Escape" && store.isOpen) store.close();
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="viewer">
      <div v-if="store.isOpen" class="viewer-layer">
        <div class="scrim" @click="store.close()" />
        <aside
          class="session-viewer"
          :aria-label="activeKind === 'trace' ? 'Delegation activity' : 'Session activity'"
        >
          <ActivityPanelHeader
            :title="headerTitle"
            :context="headerContext"
            :is-live="headerLive"
            :back-label="store.backAvailable ? backLabel : null"
            :status-label="
              agentFocus === null && activeKind === 'trace' && statusLabel
                ? statusLabel
                : null
            "
            :status-tone="statusTone"
            :show-stop="activeKind === 'trace' && isWorking"
            @back="store.back()"
            @stop="stopWatchedTask"
            @close="store.close()"
          />

          <div class="viewer-body" :class="{ 'is-thread': sessionPaneNode !== null }">
            <AgentFocusView v-if="agentFocus !== null" :focus="agentFocus" />
            <LiveSessionPane
              v-else-if="sessionPaneNode !== null"
              :key="sessionPaneNode.sessionId"
              :session-id="sessionPaneNode.sessionId"
              :title="sessionPaneNode.title"
            />
            <ActivityEntriesList
              v-else-if="activeKind !== null"
              :kind="activeKind"
              :entries="displayEntries"
              :agent-activity="agentActivity"
              :pending-approval-tool-name="pendingApprovalToolName"
              :error-text="bodyErrorText"
              :is-loading="traceQuery.isPending.value"
              :is-working="isWorking"
              :is-streaming="isStreaming"
              :has-ended="hasEnded"
              :session-drill="sessionDrill"
              @watch-agent="store.focusAgent"
              @drill-session="drillIntoSession"
              @open-delegation="
                (id) => store.push({ kind: 'trace', partialSessionId: id })
              "
            />
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* A floating overlay window (Chad's call), not a docked rail: detached from
   the edges, rounded, heavy shadow; the light scrim closes on click. */
.viewer-layer {
  position: fixed;
  inset: 40px 0 0 0;
  z-index: 45;
}

.scrim {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-shell) 45%, transparent);
}

.session-viewer {
  position: absolute;
  top: 12px;
  right: 14px;
  bottom: 14px;
  /* Just under half the window, with sane floors/ceilings. */
  width: clamp(460px, 48vw, 92vw);
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--bg-panel);
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-l);
  overflow: hidden;
  box-shadow: var(--shadow-overlay);
}

.viewer-body {
  min-height: 0;
  overflow-y: auto;
  background: var(--bg-shell);
  padding: 16px 18px;
}

/* The live session pane scrolls INSIDE its own thread and docks its composer
   at the bottom — the body wrapper gets out of the way. */
.viewer-body.is-thread {
  overflow: hidden;
  padding: 0;
}

.viewer-enter-active,
.viewer-leave-active {
  transition: opacity var(--t-slow) var(--ease-out);
}

.viewer-enter-active .session-viewer,
.viewer-leave-active .session-viewer {
  transition: transform var(--t-slow) var(--ease-out);
}

.viewer-enter-from,
.viewer-leave-to {
  opacity: 0;
}

.viewer-enter-from .session-viewer,
.viewer-leave-to .session-viewer {
  transform: translateX(24px);
}

@media (prefers-reduced-motion: reduce) {
  .viewer-enter-active,
  .viewer-leave-active,
  .viewer-enter-active .session-viewer,
  .viewer-leave-active .session-viewer {
    transition: none;
  }
}
</style>
