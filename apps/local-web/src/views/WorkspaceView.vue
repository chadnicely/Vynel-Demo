<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FolderTree, Sparkles } from "lucide-vue-next";
import { EmptyState, IconButton } from "@vynel/ui";
import SessionsPanel from "../components/chat/SessionsPanel.vue";
import ThreadStream from "../components/chat/ThreadStream.vue";
import AppComposer from "../components/chat/AppComposer.vue";
import QueuedMessageChips from "../components/chat/QueuedMessageChips.vue";
import FilesPanel from "../components/workspace/FilesPanel.vue";
import TasksPanel from "../components/tasks/TasksPanel.vue";
import FileEditorView from "../components/workspace/FileEditorView.vue";
import WorkspaceSectionPanel from "../components/workspace/WorkspaceSectionPanel.vue";
import WorkspaceWelcomeHero from "../components/workspace/WorkspaceWelcomeHero.vue";
import type { WorkspaceSectionId } from "../components/workspace/workspace-sections.js";
import { useWorkspaceList } from "../composables/workspaces/use-workspace-list.js";
import { useSessionList } from "../composables/chat/use-session-list.js";
import { useSessionDetail } from "../composables/chat/use-session-detail.js";
import { useInFlightDelegations } from "../composables/delegations/use-in-flight-delegations.js";
import { useContinuingConversation } from "../composables/chat/use-continuing-conversation.js";
import { useChatTurn } from "../composables/chat/use-chat-turn.js";
import { useQueuedSend } from "../composables/chat/use-queued-send.js";
import { useDecideApproval } from "../composables/approvals/use-decide-approval.js";
import type { SessionScope } from "../composables/chat/session-scope.js";
import type { TurnAttachmentInput } from "../composables/chat/turn-attachments.js";
import { useUiStore } from "../stores/ui-store.js";
import { useActivityStore } from "../stores/activity-store.js";
import { useSessionViewerStore } from "../stores/session-viewer-store.js";
import { formatSdkError } from "../utils/format-sdk-error.js";

// The workspace room — same continuous-first chat as global, scoped to one
// workspace. Panels beside the canvas: menu (persistent) · history · files.
const ui = useUiStore();
const shell = ui.workspaceChat;
const sessionViewer = useSessionViewerStore();

const workspacesQuery = useWorkspaceList();
const workspaces = computed(() => workspacesQuery.data.value ?? []);

// Land on a real workspace so the tab never opens dead. Reconciles once the
// list has loaded: a persisted id that no longer exists (a prior run, or a
// leftover demo id) falls back to the first workspace, or null when there are
// none — otherwise the stale id 404s every workspace-scoped request.
watch(
  [workspaces, () => workspacesQuery.isSuccess.value] as const,
  ([rows, loaded]) => {
    if (!loaded) return;
    const stored = ui.activeWorkspaceId;
    if (stored !== null && rows.some((row) => row.id === stored)) return;
    ui.activeWorkspaceId = rows[0]?.id ?? null;
  },
  { immediate: true },
);

// Switching rooms returns to that room's continuous chat.
watch(
  () => ui.activeWorkspaceId,
  () => {
    shell.target = "continuous";
    shell.mainView = "chat";
  },
);

const activeWorkspace = computed(
  () => workspaces.value.find((row) => row.id === ui.activeWorkspaceId) ?? null,
);

const scope = computed<SessionScope>(() =>
  ui.activeWorkspaceId === null
    ? { kind: "global" }
    : { kind: "workspace", workspaceId: ui.activeWorkspaceId },
);

const isFilesPanelOpen = ref(false);

const continuingQuery = useContinuingConversation(() => scope.value);

const activeSessionId = computed<string | null>(() => {
  if (shell.target === "continuous")
    return continuingQuery.data.value?.currentSdkSessionId ?? null;
  if (shell.target === "fresh") return null;
  return shell.target.sessionId;
});

const sessionsQuery = useSessionList(() => scope.value);
const sessions = computed(() => sessionsQuery.data.value ?? []);
const sessionsErrorText = computed(() =>
  sessionsQuery.isError.value
    ? formatSdkError(sessionsQuery.error.value)
    : null,
);

// A routed task streams its rows into THIS workspace's transcript in the
// background (the shared pipeline) — poll the open thread while one is in
// flight here so the task/reply/tool-calls appear live, not on refresh.
const inFlightQuery = useInFlightDelegations();
const hasInFlightDelegationHere = computed(() =>
  (inFlightQuery.data.value ?? []).some(
    (delegation) => delegation.workspaceId === ui.activeWorkspaceId,
  ),
);

const chatTurn = useChatTurn({
  scope: () => scope.value,
  onSessionCreated: (session) => {
    shell.target = { sessionId: session.id };
  },
});

// A turn running in THIS workspace outside this view's own stream — another
// tab's turn or a schedule fire — reported by the activity feed. Poll the
// open thread while one runs (same liveness rule as the delegation poll);
// this view's own turn renders through its stream, so it never counts.
const activity = useActivityStore();
const hasBackgroundTurnHere = computed(
  () =>
    !chatTurn.isStreaming.value &&
    ui.activeWorkspaceId !== null &&
    activity.hasServerTurnInWorkspace(ui.activeWorkspaceId),
);

const detailQuery = useSessionDetail(
  () => scope.value,
  () => activeSessionId.value,
  () =>
    hasInFlightDelegationHere.value || hasBackgroundTurnHere.value
      ? 4000
      : false,
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

const activeTurn = computed(() =>
  chatTurn.activeSessionId.value !== null &&
  chatTurn.activeSessionId.value === activeSessionId.value
    ? chatTurn.view.value
    : null,
);

const showsWelcome = computed(
  () => messages.value.length === 0 && activeTurn.value === null,
);

// "account" is global-only — the workspace menu never sets it, but the type
// excludes it here so the shell union stays one shared shape.
const activeSection = computed<WorkspaceSectionId | null>(() =>
  typeof shell.mainView === "string" &&
  shell.mainView !== "chat" &&
  shell.mainView !== "application" &&
  shell.mainView !== "account"
    ? shell.mainView
    : null,
);

const openFile = computed(() =>
  typeof shell.mainView === "object" ? shell.mainView : null,
);

function openFileOnCanvas(filePath: string) {
  shell.mainView = { kind: "file", filePath };
}

function sendMessage(text: string, attachments: TurnAttachmentInput[]) {
  // A fresh conversation's session id arrives via `session-created` — the turn's
  // onSessionCreated binds the shell to it; no synchronous binding here.
  void chatTurn.startTurn({
    sessionId: activeSessionId.value,
    isContinuous: shell.target === "continuous",
    userText: text,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}

// Mid-turn sends queue and fire in order as each turn settles; the drain calls
// sendMessage fresh, so a queued follow-up continues the session the first
// turn just created.
const queuedSend = useQueuedSend(chatTurn.view, sendMessage);

function openHistorySession(sessionId: string) {
  shell.target = { sessionId };
  shell.mainView = "chat";
}

// A fresh per-topic conversation — the next send creates its session.
function startFreshConversation() {
  shell.target = "fresh";
  shell.mainView = "chat";
}

function openContinuous() {
  shell.target = "continuous";
  shell.mainView = "chat";
}
</script>

<template>
  <div class="workspace-view">
    <SessionsPanel
      v-if="ui.isSessionListOpen"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :is-continuous-active="shell.target === 'continuous'"
      :is-loading="sessionsQuery.isPending.value"
      :error-text="sessionsErrorText"
      can-start-new
      @select="openHistorySession"
      @select-continuous="openContinuous"
      @start-new="startFreshConversation"
    />

    <div v-if="activeSection" class="canvas section-view">
      <!-- Marketplace runs full-width (Chad's ask — the card grid earns the
           room); the other sections keep the deliberate narrow column. -->
      <div
        class="section-column"
        :class="{ 'is-wide': activeSection === 'marketplace' }"
      >
        <WorkspaceSectionPanel
          :section="activeSection"
          :workspace-id="ui.activeWorkspaceId ?? ''"
        />
      </div>
    </div>

    <FileEditorView
      v-else-if="openFile"
      :key="openFile.filePath"
      class="canvas"
      :workspace-id="ui.activeWorkspaceId ?? ''"
      :file-path="openFile.filePath"
      @close="shell.mainView = 'chat'"
    />

    <section v-else class="canvas thread-pane">
      <div class="thread-toolbar">
        <IconButton
          label="Toggle files"
          :active="isFilesPanelOpen"
          @click="isFilesPanelOpen = !isFilesPanelOpen"
        >
          <FolderTree :size="15" />
        </IconButton>
      </div>

      <div v-if="showsWelcome" class="welcome">
        <WorkspaceWelcomeHero
          v-if="activeWorkspace"
          :workspace="activeWorkspace"
        />
        <EmptyState
          v-else
          title="Pick a workspace"
          hint="Ask for anything in this room — its files, tools, and history stay right here."
        >
          <template #icon>
            <Sparkles :size="22" />
          </template>
        </EmptyState>
      </div>
      <ThreadStream
        v-else
        :messages="messages"
        :tool-calls-by-message-id="toolCallsByMessageId"
        :active-turn="activeTurn"
        :show-watch-chips="false"
        :assistant-name="activeWorkspace?.managerName ?? 'Assistant'"
        @decide-approval="onDecideApproval"
        @open-session="sessionViewer.open"
      />

      <footer class="composer-dock">
        <QueuedMessageChips
          :queued="queuedSend.queued.value"
          @remove="queuedSend.removeQueued"
        />
        <AppComposer
          :streaming="chatTurn.isStreaming.value"
          :placeholder="
            activeWorkspace?.managerName
              ? `Ask ${activeWorkspace.managerName} for anything…`
              : `Ask about ${activeWorkspace?.name ?? 'this workspace'}…`
          "
          @send="queuedSend.submit"
          @interrupt="chatTurn.interrupt"
        />
      </footer>
    </section>

    <FilesPanel
      v-if="isFilesPanelOpen && !activeSection"
      :workspace-name="activeWorkspace?.name ?? 'Workspace'"
      :workspace-id="ui.activeWorkspaceId ?? ''"
      :active-file-path="openFile?.filePath ?? null"
      @close="isFilesPanelOpen = false"
      @open-file="openFileOnCanvas"
    />

    <TasksPanel v-if="ui.isTasksPanelOpen" />
  </div>
</template>

<style scoped>
.workspace-view {
  height: 100%;
  display: flex;
  min-height: 0;
}

.workspace-view > :not(.canvas) {
  flex: none;
}

.canvas {
  flex: 1;
  min-width: 0;
}

.thread-pane {
  position: relative;
  display: grid;
  grid-template-rows: 1fr auto;
  min-height: 0;
  background: var(--bg-shell);
}

.thread-toolbar {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 10;
}

.welcome {
  display: grid;
  place-items: center;
  overflow-y: auto;
}

.section-view {
  overflow-y: auto;
  background: var(--bg-shell);
}

.section-column {
  max-width: 760px;
  margin: 0 auto;
  padding: 44px 40px;
}

/* The marketplace's card grid uses the whole canvas — its siblings stay
   deliberately narrow (readable single-column sections). */
.section-column.is-wide {
  max-width: none;
}

.composer-dock {
  padding: 0 24px 18px;
  max-width: 968px;
  width: 100%;
  margin: 0 auto;
}
</style>
