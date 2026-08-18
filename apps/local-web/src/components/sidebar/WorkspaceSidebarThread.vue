<script setup lang="ts">
import { computed, watch } from "vue";
import { PresenceDot, ThreadSkeleton } from "@vynel/ui";
import {
  formatManagerLabel,
  resolveManagerName,
} from "@vynel/contracts/workspaces/manager-name";
import ThreadStream from "../chat/ThreadStream.vue";
import AppComposer from "../chat/AppComposer.vue";
import QueuedMessageChips from "../chat/QueuedMessageChips.vue";
import { useOpenPointerTarget } from "../chat/open-pointer-target.js";
import { useSessionDetail } from "../../composables/chat/use-session-detail.js";
import {
  useContinuingConversation,
  useContinuingSessionId,
} from "../../composables/chat/use-continuing-conversation.js";
import { useChatTurn } from "../../composables/chat/use-chat-turn.js";
import { useWatchedTurn } from "../../composables/chat/use-watched-turn.js";
import { useQueuedSend } from "../../composables/chat/use-queued-send.js";
import { useDecideApproval } from "../../composables/approvals/use-decide-approval.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { useActivityStore } from "../../stores/activity-store.js";
import type { SessionScope } from "../../composables/chat/session-scope.js";
import type { TurnAttachmentInput } from "../../composables/chat/turn-attachments.js";
import type { ComposerSettings } from "../../composables/chat/use-session-settings.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// The sidebar's WORKSPACE conversation (redesign Case 1, 2c-2): the room's
// continuing primary thread with a REAL composer — sends ride the workspace
// CONTINUE route, so a message during a delegated run queues server-side
// behind it (the B3 target lock; the sentinel surfaces as "queued" below)
// instead of colliding. A deliberate thin distillation of the WorkspaceView
// thread column for the docked panel; the full room view stays the richer
// surface (files, sections, todo dock) — recorded duplication, extract when
// a third host appears.
const props = defineProps<{
  workspaceId: string;
  /** The pointer's landing — scroll to the row carrying this trace key. */
  anchorTraceId?: string | undefined;
}>();

const scope = computed<SessionScope>(() => ({
  kind: "workspace",
  workspaceId: props.workspaceId,
}));

const workspacesQuery = useWorkspaceList();
const workspace = computed(
  () =>
    (workspacesQuery.data.value ?? []).find(
      (row) => row.id === props.workspaceId,
    ) ?? null,
);
const managerName = computed(() =>
  workspace.value === null ? "Assistant" : resolveManagerName(workspace.value),
);
const personaLabel = computed(() =>
  workspace.value === null
    ? "Workspace"
    : formatManagerLabel(managerName.value, workspace.value.name),
);

const continuingQuery = useContinuingConversation(() => scope.value);
const activeSessionId = useContinuingSessionId(() => scope.value, continuingQuery);

const chatTurn = useChatTurn({
  scope: () => scope.value,
  // The origin stream detaches once the standing watch has the turn folding
  // (live-channel slice 4) — the watch renders the rest.
  detachWhen: () => watchedTurn.hasSharedFold.value,
});

const watchedTurn = useWatchedTurn({
  sessionId: () => activeSessionId.value,
  isSuppressed: () => chatTurn.view.value !== null,
  refetchDetail: async () => {
    const result = await detailQuery.refetch();
    if (result.error) throw result.error;
    return result.data ?? undefined;
  },
});

// A turn running in this workspace outside this composer (the delegated task
// the pointer tracked, another tab's turn) — poll the thread while it runs so
// rows land near-live; the registry watch below streams the displayed
// session's turn in realtime.
const activity = useActivityStore();
const hasBackgroundTurnHere = computed(
  () =>
    activity.hasServerTurnInWorkspace(props.workspaceId) &&
    !watchedTurn.hasSharedFold.value,
);

const detailQuery = useSessionDetail(
  () => scope.value,
  () => activeSessionId.value,
  () =>
    hasBackgroundTurnHere.value && !chatTurn.isStreaming.value ? 4000 : false,
  // The sidebar thread IS the continuing conversation — read the
  // chain-spanning transcript so a context swap never empties it.
  () => "continuing",
);
const messages = computed(() => detailQuery.data.value?.messages ?? []);
const sessionModel = computed(
  () => detailQuery.data.value?.session?.model ?? null,
);
const toolCallsByMessageId = computed(
  () => detailQuery.data.value?.toolCallsByMessageId ?? {},
);

const activeTurn = computed(
  () => chatTurn.view.value ?? watchedTurn.view.value,
);
// Own OR watched — after the detach the watch is the one that knows.
const isTurnStreaming = computed(() => activeTurn.value?.status === "streaming");
const turnErrorText = computed(
  () => chatTurn.errorText.value ?? watchedTurn.lastTurnErrorText.value,
);

// The watched settle lands its rows here too (the SessionThreadView rule).
watch(
  () => watchedTurn.view.value,
  (next, previous) => {
    if (previous !== null && next === null) void detailQuery.refetch();
  },
);

// A pointer clicked INSIDE the sidebar navigates the sidebar itself: the
// one-home opener REPLACES the docked node (forward-only — Chad, 2026-08-09:
// no back stack, hop pointer to pointer).
const openPointerTarget = useOpenPointerTarget();

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

function sendMessage(
  text: string,
  _attachments: TurnAttachmentInput[],
  settings: ComposerSettings,
) {
  void chatTurn.startTurn({
    sessionId: null,
    isContinuous: true,
    userText: text,
    settings,
  });
}
const queuedSend = useQueuedSend(activeTurn, sendMessage);
</script>

<template>
  <div class="workspace-sidebar-thread">
    <div class="thread-body">
      <ThreadSkeleton
        v-if="detailQuery.isPending.value"
        class="thread-skeleton-pad"
      />
      <p v-else-if="detailQuery.isError.value" class="state-note is-error">
        {{ formatSdkError(detailQuery.error.value) }}
      </p>
      <ThreadStream
        v-else
        class="thread-slot"
        :messages="messages"
        :tool-calls-by-message-id="toolCallsByMessageId"
        :active-turn="activeTurn"
        :assistant-name="managerName"
        :session-model="sessionModel"
        :scroll-to-trace-id="props.anchorTraceId"
        @decide-approval="onDecideApproval"
        @open-pointer="openPointerTarget"
      />
    </div>

    <footer class="composer-dock">
      <QueuedMessageChips
        :queued="queuedSend.queued.value"
        @remove="queuedSend.removeQueued"
      />
      <p v-if="chatTurn.isQueuedBehindTask.value" class="queued-note">
        <PresenceDot state="live" />
        {{
          chatTurn.queuedReason.value === "context-patching"
            ? "Patching context — your message continues right after."
            : "Working on a task — your message is queued."
        }}
      </p>
      <p v-if="turnErrorText" class="turn-error-note">
        {{ turnErrorText }}
      </p>
      <AppComposer
        :session-id="activeSessionId"
        :streaming="isTurnStreaming"
        :placeholder="`Message ${managerName}…`"
        :allow-attachments="false"
        :scope="scope"
        :destination-label="personaLabel"
        @send="queuedSend.submit"
        @interrupt="chatTurn.interrupt(activeSessionId)"
      />
    </footer>
  </div>
</template>

<style scoped>
.workspace-sidebar-thread {
  /* A narrow docked panel, not the canvas column: 22.4px would eat a 320px
     width. Set HERE, on the common ancestor, so the thread, the composer and
     the skeleton share one edge — a child can't reach its own siblings. */
  --thread-gutter: 12px;
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
  padding-left: var(--thread-gutter);
}
.state-note {
  margin: 24px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.state-note.is-error {
  color: var(--danger);
}
.composer-dock {
  padding: 8px var(--thread-gutter) 12px;
  border-top: 1px solid var(--hair);
}
.queued-note,
.turn-error-note {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0 0 6px;
  font-size: 11.5px;
  color: var(--ink-3);
}
.turn-error-note {
  color: var(--danger);
}
</style>
