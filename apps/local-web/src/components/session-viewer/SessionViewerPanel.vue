<script setup lang="ts">
import { computed } from "vue";
import { X } from "lucide-vue-next";
import { IconButton, MarkdownText, PresenceDot, ToolCallList } from "@vynel/ui";
import { useDelegationTrace } from "../../composables/delegations/use-delegation-trace.js";
import { collapseTraceEcho } from "../../composables/delegations/collapse-trace-echo.js";
import { useSessionViewerStore } from "../../stores/session-viewer-store.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// The right-side "watch a delegation" panel. A report message's "Watch X" chip
// carries the delegation's partialSessionId (a correlation key, NOT a session
// id); this polls its condensed trace (task → workspace reply → report) and
// fills in live while the routed task is still running.
const viewer = useSessionViewerStore();

const traceQuery = useDelegationTrace(() => viewer.currentSessionId);
const entries = computed(() => traceQuery.data.value?.entries ?? []);

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

type TraceEntry = (typeof entries.value)[number];

function authorLabel(entry: TraceEntry): string {
  if (entry.role === "user")
    return entry.sourceKind === "global-root" ? "From Global" : "You";
  if (entry.sourceLabel) return `Assistant · ${entry.sourceLabel}`;
  return "Assistant";
}
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
              </p>
              <p v-if="statusLabel" class="viewer-context">{{ statusLabel }}</p>
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
              <div v-for="entry in displayEntries" :key="entry.id" class="entry">
                <p class="entry-author">{{ authorLabel(entry) }}</p>
                <ToolCallList
                  v-if="entry.toolCalls.length > 0"
                  class="entry-tools"
                  :tool-calls="entry.toolCalls"
                />
                <MarkdownText :source="entry.body" />
              </div>
              <p v-if="isWorking" class="working-note">
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
