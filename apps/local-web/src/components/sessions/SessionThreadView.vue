<script setup lang="ts">
import { computed } from "vue";
import { ArrowLeft } from "lucide-vue-next";
import { PresenceDot } from "@vynel/ui";
import { useActivityMonitor } from "../../composables/activity/use-activity-monitor.js";
import { useSessionTurn } from "../../composables/sessions/use-session-turn.js";
import { mergeTraceEntries } from "../../composables/delegations/fold-trace-stream.js";
import { useActivityMonitorStore } from "../../stores/activity-monitor-store.js";
import ActivityEntriesList from "../activity/ActivityEntriesList.vue";
import AppComposer from "../chat/AppComposer.vue";

// One session's FULL chat-style view inside the Sessions library (Slice ③):
// the settled transcript + live overlay through the ONE monitor seam, plus a
// composer when the session is directly chattable (a spawned session's chain
// head). Superseded chain parts and primary transcripts render view-only —
// the host says where chat continues.
const props = defineProps<{
  sessionId: string;
  title: string;
  /** Direct turns allowed — the spawned chain head (locked decisions 1–3). */
  chattable: boolean;
  /** View-only hint (a superseded part, a read-only scope). Null = none. */
  viewOnlyNote: string | null;
}>();

const emit = defineEmits<{
  back: [];
}>();

const activityMonitor = useActivityMonitorStore();

// The monitor renders history + the session channel's live turns (a delegated
// task streaming into this session shows up here without any wiring). The
// composer's own turn folds beside it; the id-dedupe merge keeps one list.
const monitor = useActivityMonitor(() => ({
  kind: "session" as const,
  id: props.sessionId,
}));
const turn = useSessionTurn(() => props.sessionId);

const entries = computed(() =>
  mergeTraceEntries(monitor.entries.value, turn.state.value.entries),
);
const agentActivity = computed(() => ({
  ...monitor.agentActivity.value,
  ...turn.state.value.agentActivity,
}));
const pendingApprovalToolName = computed(
  () =>
    turn.state.value.pendingApprovalToolName ??
    monitor.pendingApprovalToolName.value,
);
const isStreaming = computed(
  () => turn.isStreaming.value || monitor.isStreaming.value,
);

// The composer runs text-only (`allow-attachments=false` — the session-turn
// route takes no files), so a send is always just its text.
function sendMessage(text: string) {
  void turn.startTurn(text);
}

// An agent drill-down opens the shared monitor overlay focused on that agent
// (the same node stack every Watch surface uses).
function watchAgent(toolUseId: string) {
  activityMonitor.openSession(props.sessionId, props.title);
  activityMonitor.focusAgent(toolUseId);
}
</script>

<template>
  <div class="session-thread">
    <header class="thread-header">
      <button
        type="button"
        class="back-button"
        aria-label="Back to all sessions"
        @click="emit('back')"
      >
        <ArrowLeft :size="14" />
        Sessions
      </button>
      <p class="thread-title">{{ props.title }}</p>
      <PresenceDot v-if="isStreaming" state="live" label="live" />
    </header>

    <div class="thread-body">
      <!-- Only the MONITOR's error belongs to the list (its states are
           exclusive — a composer-turn failure must never blank the
           transcript); the turn's own error renders beside the composer. -->
      <ActivityEntriesList
        kind="session"
        :entries="entries"
        :agent-activity="agentActivity"
        :pending-approval-tool-name="pendingApprovalToolName"
        :error-text="monitor.errorText.value"
        :is-loading="false"
        :is-working="false"
        :is-streaming="isStreaming"
        :has-ended="monitor.hasEnded.value"
        @watch-agent="watchAgent"
      />
    </div>

    <p v-if="props.viewOnlyNote" class="view-only-note">
      {{ props.viewOnlyNote }}
    </p>

    <footer v-if="props.chattable" class="composer-dock">
      <p v-if="turn.isQueued.value" class="queued-note">
        <PresenceDot state="live" />
        Working on a task — your message is queued.
      </p>
      <p v-if="turn.errorText.value" class="turn-error-note">
        {{ turn.errorText.value }}
      </p>
      <AppComposer
        :streaming="turn.isStreaming.value"
        :placeholder="`Message ${props.title}…`"
        :allow-attachments="false"
        @send="sendMessage"
        @interrupt="turn.interrupt"
      />
    </footer>
  </div>
</template>

<style scoped>
.session-thread {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--bg-shell);
}

.thread-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 24px;
  border-bottom: 1px solid var(--hair);
}

.back-button {
  appearance: none;
  border: 1px solid var(--hair);
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 99px;
  background: transparent;
  color: var(--ink-2);
  font: 600 11.5px/1.5 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.back-button:hover {
  color: var(--ink-1);
  border-color: var(--hair-strong);
  background: var(--row-hover);
}

.back-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.thread-title {
  margin: 0;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.thread-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 24px;
}

/* Locked decision 2 made visible: a dead chain part never grows a composer —
   the note says where the conversation carries on. */
.view-only-note {
  margin: 0;
  padding: 10px 24px 16px;
  text-align: center;
  color: var(--ink-3);
  font: 400 12px/1.6 var(--font-ui);
}

.composer-dock {
  padding: 0 24px 18px;
  max-width: 968px;
  width: 100%;
  margin: 0 auto;
}

.queued-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  padding: 8px 12px;
  border: 1px solid var(--gold-soft);
  border-radius: var(--radius-m);
  background: var(--gold-soft);
  color: var(--ink-1);
  font: 600 12px/1.5 var(--font-ui);
}

.turn-error-note {
  margin: 0 0 8px;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}
</style>
