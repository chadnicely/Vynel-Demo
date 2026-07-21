<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { X } from "lucide-vue-next";
import { IconButton, MarkdownText, PresenceDot, ToolCallList } from "@vynel/ui";
import { useSessionWatch } from "../../composables/sessions/use-session-watch.js";
import { useSessionWatchStore } from "../../stores/session-watch-store.js";

// The "watch any session live" overlay (the Sessions view's Watch): attaches
// to the session's SSE observe stream and renders the turn as it happens —
// the delegation viewer's look, minus the job status (a session has no queue).
// The stream ends per turn; the folded activity stays on screen so the person
// sees what just happened.
const watchStore = useSessionWatchStore();

const {
  entries,
  agentActivity,
  pendingApprovalToolName,
  isStreaming,
  hasEnded,
  errorText,
} = useSessionWatch(() => watchStore.sessionId);

type WatchEntry = (typeof entries.value)[number];

// Persona-first author labels, matching the trace viewer.
function authorLabel(entry: WatchEntry): string {
  if (entry.role === "user")
    return entry.sourceKind === "global-root" ? "From Claude" : "You";
  return entry.sourceLabel ?? "Assistant";
}

const emptyNote = computed(() =>
  hasEnded.value
    ? "The reply finished — you're all caught up."
    : "Watching live — the moment something runs here, it shows up.",
);

function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  if (event.key === "Escape" && watchStore.isOpen) watchStore.close();
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Transition name="watch">
    <div v-if="watchStore.isOpen" class="watch-layer">
      <div class="scrim" @click="watchStore.close()" />
      <aside class="session-watch" aria-label="Live session view">
        <header class="watch-header">
          <div class="titles">
            <p class="watch-title">
              <PresenceDot :state="isStreaming ? 'live' : 'idle'" />
              {{ watchStore.title }}
            </p>
            <p class="watch-context">
              Watching this conversation live — replies and tool use show up
              here as they happen.
            </p>
          </div>
          <IconButton label="Close" @click="watchStore.close()">
            <X :size="15" />
          </IconButton>
        </header>

        <div class="watch-body">
          <p v-if="errorText" class="state-note is-error">{{ errorText }}</p>
          <p v-else-if="entries.length === 0" class="state-note">
            {{ emptyNote }}
          </p>
          <div v-else class="trace">
            <div v-for="entry in entries" :key="entry.id" class="entry">
              <p class="entry-author">{{ authorLabel(entry) }}</p>
              <ToolCallList
                v-if="entry.toolCalls.length > 0"
                class="entry-tools"
                :tool-calls="entry.toolCalls"
                :agent-activity="agentActivity"
              />
              <MarkdownText :source="entry.body" />
            </div>
            <p v-if="pendingApprovalToolName" class="working-note is-approval">
              <PresenceDot state="live" />
              Waiting for your approval: {{ pendingApprovalToolName }} — the
              reply is paused until you decide.
            </p>
            <p v-else-if="isStreaming" class="working-note">
              <PresenceDot state="live" /> Still working…
            </p>
            <p v-else-if="hasEnded" class="state-note">
              The reply finished — you're all caught up.
            </p>
          </div>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
/* The trace viewer's floating-overlay treatment, one layer down (the viewer
   sits at 45; a Watch opened from the Sessions canvas never stacks under it). */
.watch-layer {
  position: fixed;
  inset: 40px 0 0 0;
  z-index: 44;
}

.scrim {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-shell) 45%, transparent);
}

.session-watch {
  position: absolute;
  top: 12px;
  right: 14px;
  bottom: 14px;
  width: clamp(460px, 48vw, 92vw);
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--bg-panel);
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-l);
  overflow: hidden;
  box-shadow: var(--shadow-overlay);
}

.watch-header {
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

.watch-title {
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

.watch-context {
  margin: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.watch-body {
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

.working-note.is-approval {
  padding: 9px 12px;
  border: 1px solid var(--gold-soft);
  border-radius: var(--radius-m);
  background: var(--gold-soft);
  color: var(--ink-1);
  font-weight: 600;
}

.watch-enter-active,
.watch-leave-active {
  transition: opacity var(--t-slow) var(--ease-out);
}

.watch-enter-active .session-watch,
.watch-leave-active .session-watch {
  transition: transform var(--t-slow) var(--ease-out);
}

.watch-enter-from,
.watch-leave-to {
  opacity: 0;
}

.watch-enter-from .session-watch,
.watch-leave-to .session-watch {
  transform: translateX(24px);
}

@media (prefers-reduced-motion: reduce) {
  .watch-enter-active,
  .watch-leave-active,
  .watch-enter-active .session-watch,
  .watch-leave-active .session-watch {
    transition: none;
  }
}
</style>
