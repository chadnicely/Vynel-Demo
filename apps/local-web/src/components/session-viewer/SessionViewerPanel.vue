<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { X } from "lucide-vue-next";
import { IconButton, MarkdownText, PresenceDot, ToolCallList } from "@vynel/ui";
import { useDelegationTraceLive } from "../../composables/delegations/use-delegation-trace-live.js";
import { collapseTraceEcho } from "../../composables/delegations/collapse-trace-echo.js";
import { useSessionViewerStore } from "../../stores/session-viewer-store.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// The right-side "watch a delegation" panel. A report message's "Watch X" chip
// carries the delegation's partialSessionId (a correlation key, NOT a session
// id). The settled trace comes from one fetch; the live tail streams over the
// SSE observe connection (token-level — polling only remains as the fallback
// when the stream drops).
const viewer = useSessionViewerStore();

const { traceQuery, entries, pendingApprovalToolName } = useDelegationTraceLive(
  () => viewer.currentSessionId,
);

// The workspace reply and the surfaced global report carry the SAME body — the
// backend trace is deliberately faithful (both copies returned); display
// collapses the echo (see collapse-trace-echo.ts).
const displayEntries = computed(() => collapseTraceEcho(entries.value));

const status = computed(() => traceQuery.data.value?.status ?? null);
const isWorking = computed(
  () => status.value === "pending" || status.value === "claimed",
);

const errorText = computed(() =>
  traceQuery.isError.value ? formatSdkError(traceQuery.error.value) : null,
);

// The first labelled entry names the delegated workspace/manager (e.g. "Noah · vynel").
const title = computed(
  () => entries.value.find((entry) => entry.sourceLabel)?.sourceLabel ?? "Delegation",
);

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

type TraceEntry = (typeof entries.value)[number];

function authorLabel(entry: TraceEntry): string {
  if (entry.role === "user")
    return entry.sourceKind === "global-root" ? "From Global" : "You";
  if (entry.sourceLabel) return `Assistant · ${entry.sourceLabel}`;
  return "Assistant";
}

// The instruction that started the delegation reads differently from the
// replies — it gets the task-card treatment.
function isTaskEntry(entry: TraceEntry): boolean {
  return entry.role === "user";
}

function onKeydown(event: KeyboardEvent) {
  // An inner overlay (e.g. the new-workspace dialog) that handled this press
  // claims it via preventDefault — only the topmost overlay closes.
  if (event.defaultPrevented) return;
  if (event.key === "Escape" && viewer.isOpen) viewer.close();
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="viewer">
      <div v-if="viewer.isOpen" class="viewer-layer">
        <div class="scrim" @click="viewer.close()" />
        <aside class="session-viewer" aria-label="Delegation activity">
          <header class="viewer-header">
            <div class="titles">
              <p class="viewer-title">
                <PresenceDot :state="isWorking ? 'live' : 'idle'" />
                {{ title }}
                <span
                  v-if="statusLabel"
                  class="status-pill"
                  :class="statusTone ? `is-${statusTone}` : ''"
                >
                  {{ statusLabel }}
                </span>
              </p>
              <p class="viewer-context">
                Watching this task live — everything the workspace does shows
                up here.
              </p>
            </div>
            <IconButton label="Close" @click="viewer.close()">
              <X :size="15" />
            </IconButton>
          </header>

          <div class="viewer-body">
            <p v-if="errorText" class="state-note is-error">{{ errorText }}</p>
            <p v-else-if="traceQuery.isPending.value" class="state-note">
              Loading…
            </p>
            <p v-else-if="entries.length === 0" class="state-note">
              {{
                isWorking
                  ? "The workspace is working — its activity appears here as it's recorded."
                  : "No activity recorded for this task."
              }}
            </p>
            <div v-else class="trace">
              <div
                v-for="entry in displayEntries"
                :key="entry.id"
                class="entry"
                :class="{ 'is-task': isTaskEntry(entry) }"
              >
                <p class="entry-author">{{ authorLabel(entry) }}</p>
                <ToolCallList
                  v-if="entry.toolCalls.length > 0"
                  class="entry-tools"
                  :tool-calls="entry.toolCalls"
                />
                <MarkdownText :source="entry.body" />
              </div>
              <p v-if="pendingApprovalToolName" class="working-note is-approval">
                <PresenceDot state="live" />
                Waiting for your approval: {{ pendingApprovalToolName }} — the
                task is paused until you decide.
              </p>
              <p v-else-if="isWorking" class="working-note">
                <PresenceDot state="live" /> Still working…
              </p>
            </div>
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

.viewer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--hair);
}

.titles {
  flex: 1;
  min-width: 0;
}

.viewer-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.viewer-context {
  margin: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-pill {
  flex: none;
  padding: 1px 8px;
  border-radius: 99px;
  border: 1px solid var(--hair-strong);
  color: var(--ink-2);
  font: 600 10px/1.5 var(--font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.status-pill.is-live {
  border-color: var(--gold-soft);
  background: var(--gold-soft);
  color: var(--gold);
  animation: pill-breathe 1.6s var(--ease-out) infinite;
}

@keyframes pill-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-pill.is-live {
    animation: none;
  }
}

.status-pill.is-ok {
  border-color: transparent;
  background: color-mix(in srgb, var(--ok) 16%, transparent);
  color: var(--ok);
}

.status-pill.is-danger {
  border-color: transparent;
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}

.viewer-body {
  min-height: 0;
  overflow-y: auto;
  background: var(--bg-shell);
  padding: 16px 18px;
}

.trace {
  max-width: 760px;
  margin: 0 auto;
  display: grid;
  gap: 18px;
}

.entry {
  display: grid;
  gap: 6px;
}

/* The instruction that STARTED the task — a quoted card, visually distinct
   from the assistant's replies below it. */
.entry.is-task {
  padding: 10px 14px;
  border: 1px solid var(--hair);
  border-left: 3px solid var(--hair-strong);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
}

.entry-author {
  margin: 0;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.state-note {
  margin: 16px 0 0;
  text-align: center;
  color: var(--ink-3);
  font: 400 12.5px/1.6 var(--font-ui);
}

.state-note.is-error {
  color: var(--danger);
}

.working-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 0;
  color: var(--ink-2);
  font: 500 12px/1.5 var(--font-ui);
}

/* Needs-you moment — the one gold banner in the panel. */
.working-note.is-approval {
  padding: 9px 12px;
  border: 1px solid var(--gold-soft);
  border-radius: var(--radius-m);
  background: var(--gold-soft);
  color: var(--ink-1);
  font-weight: 600;
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
