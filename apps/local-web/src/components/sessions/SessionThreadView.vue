<script setup lang="ts">
import { computed } from "vue";
import { PresenceDot, ThreadSkeleton } from "@vynel/ui";
import ThreadStream from "../chat/ThreadStream.vue";
import AppComposer from "../chat/AppComposer.vue";
import QueuedMessageChips from "../chat/QueuedMessageChips.vue";
import { useSessionDetail } from "../../composables/chat/use-session-detail.js";
import { useSessionTurn } from "../../composables/sessions/use-session-turn.js";
import { useQueuedSend } from "../../composables/chat/use-queued-send.js";
import { useDecideApproval } from "../../composables/approvals/use-decide-approval.js";
import { useActivityStore } from "../../stores/activity-store.js";
import { useActivityMonitorStore } from "../../stores/activity-monitor-store.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// A session opened from the Sessions list renders as a NORMAL CHAT — the same
// ThreadStream/MessageRow path the continue-session chats use (Chad: "no
// special menus, it's simple"). Settled rows come from the session detail
// (`root.getSession` — owner-gated, any scope); a composer-driven turn streams
// through the shared live-turn view. A composer appears only when the session
// is directly chattable (a spawned chain head — locked decisions 1–3);
// superseded chain parts render view-only with the head hint.
const props = defineProps<{
  sessionId: string;
  title: string;
  /** Direct turns allowed — the spawned chain head (locked decisions 1–3). */
  chattable: boolean;
  /** View-only hint (a superseded part, a read-only scope). Null = none. */
  viewOnlyNote: string | null;
}>();

const activity = useActivityStore();
const activityMonitor = useActivityMonitorStore();
const turn = useSessionTurn(() => props.sessionId);

// A turn running in this session OUTSIDE this composer (a delegated task, a
// queued job draining) — reported by the activity feed with the session's sdk
// id. While one runs, poll the thread so its rows appear live (the views'
// liveness rule; rows persist per chunk server-side).
// KNOWN + ACCEPTED (reviewer note): both this match and the host's pane key
// are the OPENED segment id — a mid-turn compaction swap moves the chain onto
// a fresh segment this pane doesn't track, so the poll stops and the thread
// freezes until the session is reopened from the list (which always resolves
// the current head). Rare, self-healing on reopen; re-keying live would need
// the overview refetch loop wired through the pane.
const hasBackgroundTurnHere = computed(() =>
  Object.values(activity.serverTurns).some(
    (serverTurn) => serverTurn.sessionId === props.sessionId,
  ),
);

const detailQuery = useSessionDetail(
  { kind: "global" },
  () => props.sessionId,
  () => (hasBackgroundTurnHere.value && !turn.isStreaming.value ? 4000 : false),
);
const messages = computed(() => detailQuery.data.value?.messages ?? []);
const toolCallsByMessageId = computed(
  () => detailQuery.data.value?.toolCallsByMessageId ?? {},
);

const decideApproval = useDecideApproval();

function onDecideApproval(
  approvalRequestId: string,
  decision: "approved" | "denied",
) {
  decideApproval.mutate(
    decision === "approved"
      ? { providerApprovalId: approvalRequestId, kind: "approved" }
      : {
          providerApprovalId: approvalRequestId,
          kind: "denied",
          reason: "Denied from chat.",
        },
  );
}

// The composer runs text-only (`allow-attachments=false` — the session-turn
// route takes no files), so a send is always just its text.
function sendMessage(text: string) {
  void turn.startTurn(text);
}

// Mid-turn sends QUEUE and fire in order as each turn settles (the chat views'
// contract — ChatComposer clears the draft on emit, so the host must never
// drop a send). Text-only surface: the attachments half rides along empty.
const queuedSend = useQueuedSend(turn.view, sendMessage);
</script>

<template>
  <div class="session-thread">
    <div class="thread-body">
      <ThreadSkeleton v-if="detailQuery.isPending.value" class="thread-skeleton-pad" />
      <!-- A failed transcript read must be SAID — an empty thread over a live
           composer would read as a blank conversation. -->
      <p v-else-if="detailQuery.isError.value" class="state-note is-error">
        {{ formatSdkError(detailQuery.error.value) }}
      </p>
      <!-- Pipeline scoping rule 3 (Chad, 2026-07-21 evening): a SESSION view
           is a leaf — agent chips only. No trace/report chips, and the task
           rows that targeted this session show none either. -->
      <ThreadStream
        v-else
        class="thread-slot"
        :messages="messages"
        :tool-calls-by-message-id="toolCallsByMessageId"
        :active-turn="turn.view.value"
        :assistant-name="props.title"
        :show-watch-chips="false"
        @decide-approval="onDecideApproval"
        @open-session="activityMonitor.openTrace"
        @watch-agent="activityMonitor.openAgentDirect"
      />
    </div>

    <p v-if="props.viewOnlyNote" class="view-only-note">
      {{ props.viewOnlyNote }}
    </p>

    <footer v-if="props.chattable" class="composer-dock">
      <QueuedMessageChips
        :queued="queuedSend.queued.value"
        @remove="queuedSend.removeQueued"
      />
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
        @send="queuedSend.submit"
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

.thread-body {
  flex: 1;
  min-height: 0;
}

.thread-slot {
  height: 100%;
}

.thread-skeleton-pad {
  padding-left: 24px;
  padding-right: 24px;
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
