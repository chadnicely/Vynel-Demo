<script setup lang="ts">
import { computed, watch } from "vue";
import { PresenceDot, ThreadSkeleton } from "@vynel/ui";
import ThreadStream from "../chat/ThreadStream.vue";
import { useOpenPointerTarget } from "../chat/open-pointer-target.js";
import AppComposer from "../chat/AppComposer.vue";
import QueuedMessageChips from "../chat/QueuedMessageChips.vue";
import TodoDock from "../chat/TodoDock.vue";
import { useSessionDetail } from "../../composables/chat/use-session-detail.js";
import { useSessionsOverview } from "../../composables/sessions/use-sessions-overview.js";
import { resolveChainHead } from "../../composables/sessions/resolve-chain-head.js";
import { useSessionTurn } from "../../composables/sessions/use-session-turn.js";
import { useWatchedTurn } from "../../composables/chat/use-watched-turn.js";
import { useQueuedSend } from "../../composables/chat/use-queued-send.js";
import { useDecideApproval } from "../../composables/approvals/use-decide-approval.js";
import { useActivityStore } from "../../stores/activity-store.js";
import type { TurnAttachmentInput } from "../../composables/chat/turn-attachments.js";
import type { ComposerSettings } from "../../composables/chat/use-session-settings.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// A session opened from the Sessions list or the monitor's live pane renders
// as a NORMAL CHAT — the same ThreadStream/MessageRow path the
// continue-session chats use (Chad: "no special menus, it's simple"). Settled
// rows come from the session detail (`root.getSession` — owner-gated, any
// scope); a composer-driven turn streams through the shared live-turn view,
// and turns the session runs on its OWN (a delegated task draining) stream in
// through the registry watch. A composer appears only when the session is
// directly chattable (a spawned chain head — locked decisions 1–3);
// superseded chain parts render view-only with the head hint.
const props = defineProps<{
  sessionId: string;
  title: string;
  /** Direct turns allowed — the spawned chain head (locked decisions 1–3). */
  chattable: boolean;
  /** View-only hint (a superseded part, a read-only scope). Null = none. */
  viewOnlyNote: string | null;
  /** Follow the chain onto a fresh head live (a mid-turn compaction swap
   *  moves the conversation to a new segment — B6 kills the old accepted
   *  freeze). False for a deliberately-opened EARLIER part: that view stays
   *  put on its segment. */
  followChain: boolean;
  /** Scroll to the row carrying this trace key on open (the pointer's landing
   *  — redesign Case 1: "click will scroll to where the partial id is").
   *  Absent = open at the latest message like any chat. */
  anchorTraceId?: string | undefined;
}>();

const activity = useActivityStore();

// A pointer in this session's own thread (it delegated work of its own):
// the one-home opener swaps the sidebar to the target — from the docked pane
// that REPLACES the node in place (forward-only, no back stack), from the
// Sessions canvas it opens the sidebar like any thread.
const openPointerTarget = useOpenPointerTarget();

// Chain-head resolution (B6): the overview names every chain's newest segment;
// while a turn runs anywhere the list refetches, so a mid-turn swap re-points
// this view at the fresh head — detail, turn target, and the live watch all
// key on the RESOLVED id. The quiet note below says when that happened.
const overviewQuery = useSessionsOverview(
  () => props.followChain,
  () => (activity.isTurnRunning ? 5000 : false),
);
const resolvedHead = computed(() =>
  props.followChain
    ? resolveChainHead(overviewQuery.data.value ?? [], props.sessionId)
    : null,
);
const activeSessionId = computed(
  () => resolvedHead.value?.headId ?? props.sessionId,
);
const continuedNote = computed(() =>
  resolvedHead.value?.isSuperseded
    ? "This conversation continued onto a fresh session — showing the newest part."
    : null,
);

const turn = useSessionTurn(() => activeSessionId.value);

// A turn running in this session OUTSIDE this composer (a delegated task, a
// queued job draining) — reported by the activity feed with the session's sdk
// id. The registry watch below streams it live; this poll is the fallback
// that keeps rows landing if that channel drops (rows persist per chunk
// server-side).
const hasBackgroundTurnHere = computed(() =>
  Object.values(activity.serverTurns).some(
    (serverTurn) => serverTurn.sessionId === activeSessionId.value,
  ),
);

const detailQuery = useSessionDetail(
  { kind: "global" },
  () => activeSessionId.value,
  () => (hasBackgroundTurnHere.value && !turn.isStreaming.value ? 4000 : false),
  // A followed chain reads the chain-spanning transcript (a compaction swap
  // must never empty this view); a deliberately-opened earlier part stays
  // put on its own segment.
  () => (props.followChain ? "chain" : "segment"),
);
const messages = computed(() => detailQuery.data.value?.messages ?? []);
const sessionModel = computed(
  () => detailQuery.data.value?.session?.model ?? null,
);
const toolCallsByMessageId = computed(
  () => detailQuery.data.value?.toolCallsByMessageId ?? {},
);

// The standing subscription to this session's live channel (B6): a turn the
// composer does not own — a delegated task, a routed message draining —
// streams here in realtime instead of crawling on the fallback poll. The own
// overlay always wins (render-time suppression, B3).
const watchedTurn = useWatchedTurn({
  sessionId: () => activeSessionId.value,
  isSuppressed: () => turn.view.value !== null,
  // refetch() resolves (never throws) — surface the failure so the watcher's
  // seed retries instead of silently seeding from stale cache.
  refetchDetail: async () => {
    const result = await detailQuery.refetch();
    if (result.error) throw result.error;
    return result.data ?? undefined;
  },
});
const activeTurn = computed(() => turn.view.value ?? watchedTurn.view.value);

// A watched turn's settle must land its rows HERE too: the registry's settle
// snapshot only warms the subscription that owns the provider slot (the
// monitor's, when this thread renders inside the panel) — refetch as the
// overlay clears so the thread never blinks back to a stale transcript. The
// feed's turn-end invalidation covers the same gap app-wide; this keeps the
// pane honest on its own channel.
watch(
  () => watchedTurn.view.value,
  (next, previous) => {
    if (previous !== null && next === null) void detailQuery.refetch();
  },
);

// The mention rosters follow the session's GROUNDING (a workspace-grounded
// spawned thread sees that workspace's agents/skills/commands; a
// global-grounded one the user scope) — mirroring where the server grounds
// this thread's @ dispatches.
const composerScope = computed(() => {
  const workspaceId = detailQuery.data.value?.session?.workspaceId ?? null;
  return workspaceId === null
    ? ({ kind: "global" } as const)
    : ({ kind: "workspace", workspaceId } as const);
});

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
// route takes no files), so a send is its text + the composer settings.
function sendMessage(
  text: string,
  _attachments: TurnAttachmentInput[],
  settings: ComposerSettings,
) {
  void turn.startTurn(text, settings);
}

// Mid-turn sends QUEUE and fire in order as each turn settles (the chat views'
// contract — ChatComposer clears the draft on emit, so the host must never
// drop a send). Text-only surface: the attachments half rides along empty.
const queuedSend = useQueuedSend(turn.view, sendMessage);
</script>

<template>
  <div class="session-thread">
    <div class="thread-body">
      <ThreadSkeleton
        v-if="detailQuery.isPending.value"
        class="thread-skeleton-pad"
      />
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
        :active-turn="activeTurn"
        :assistant-name="props.title"
        :session-model="sessionModel"
        :scroll-to-trace-id="props.anchorTraceId"
        @decide-approval="onDecideApproval"
        @open-pointer="openPointerTarget"
      />
    </div>

    <p v-if="continuedNote" class="view-only-note">
      {{ continuedNote }}
    </p>

    <p
      v-if="watchedTurn.errorText.value"
      class="view-only-note is-drop"
      data-testid="live-drop-note"
    >
      Live updates dropped — reconnecting; new replies land in the transcript.
    </p>

    <p v-if="props.viewOnlyNote" class="view-only-note">
      {{ props.viewOnlyNote }}
    </p>

    <footer v-if="props.chattable" class="composer-dock">
      <TodoDock :session-id="activeSessionId" />
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
        :session-id="activeSessionId"
        :streaming="turn.isStreaming.value"
        :placeholder="`Message ${props.title}…`"
        :allow-attachments="false"
        :scope="composerScope"
        :destination-label="props.title"
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

.view-only-note.is-drop {
  color: var(--danger);
}

/* A canvas chat surface like Workspace/Global — full-bleed on the thread's
   own gutter. */
.composer-dock {
  padding: 10px var(--thread-gutter, 22.4px) 12px;
  width: 100%;
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
