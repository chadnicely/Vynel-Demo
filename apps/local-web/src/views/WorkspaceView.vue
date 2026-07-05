<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FolderTree, Sparkles } from "lucide-vue-next";
import { EmptyState, IconButton } from "@vynel/ui";
import SessionsPanel from "../components/chat/SessionsPanel.vue";
import ThreadStream from "../components/chat/ThreadStream.vue";
import AppComposer from "../components/chat/AppComposer.vue";
import MenuPanel from "../components/shell/MenuPanel.vue";
import FilesPanel from "../components/workspace/FilesPanel.vue";
import FileEditorView from "../components/workspace/FileEditorView.vue";
import WorkspaceSectionPanel from "../components/workspace/WorkspaceSectionPanel.vue";
import { WORKSPACE_SECTIONS } from "../components/workspace/workspace-sections.js";
import type { WorkspaceSectionId } from "../components/workspace/workspace-sections.js";
import { useWorkspaceList } from "../composables/workspaces/use-workspace-list.js";
import { useSessionList } from "../composables/chat/use-session-list.js";
import { useSessionDetail } from "../composables/chat/use-session-detail.js";
import { useContinuingConversation } from "../composables/chat/use-continuing-conversation.js";
import { useChatTurn } from "../composables/chat/use-chat-turn.js";
import type { SessionScope } from "../composables/chat/session-scope.js";
import { useUiStore } from "../stores/ui-store.js";
import { formatSdkError } from "../utils/format-sdk-error.js";
import { demoFileTreesByWorkspaceId } from "../demo/fixtures/file-trees.js";

// The workspace room — same continuous-first chat as global, scoped to one
// workspace. Panels beside the canvas: menu (persistent) · history · files.
const ui = useUiStore();
const shell = ui.workspaceChat;

const WORKSPACE_MENU_ITEMS = [
  { id: "chat", label: "Chat", hint: "The conversation" },
  ...WORKSPACE_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    hint: section.hint,
  })),
];

const workspacesQuery = useWorkspaceList();
const workspaces = computed(() => workspacesQuery.data.value ?? []);

// Land on the last-used workspace so the tab never opens dead.
watch(
  workspaces,
  (rows) => {
    if (ui.activeWorkspaceId === null && rows.length > 0) {
      ui.activeWorkspaceId = rows[0]!.id;
    }
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
const sessions = computed(() => sessionsQuery.data.value?.sessions ?? []);
const sessionsErrorText = computed(() =>
  sessionsQuery.isError.value
    ? formatSdkError(sessionsQuery.error.value)
    : null,
);

const detailQuery = useSessionDetail(() => activeSessionId.value);
const messages = computed(() => detailQuery.data.value?.messages ?? []);
const toolCallsByMessageId = computed(
  () => detailQuery.data.value?.toolCallsByMessageId ?? {},
);

const chatTurn = useChatTurn({
  scope: () => scope.value,
  onSessionCreated: (session) => {
    shell.target = { sessionId: session.id };
  },
});

const activeTurn = computed(() =>
  chatTurn.activeSessionId.value !== null &&
  chatTurn.activeSessionId.value === activeSessionId.value
    ? chatTurn.view.value
    : null,
);

const showsWelcome = computed(
  () => messages.value.length === 0 && activeTurn.value === null,
);

const fileTree = computed(() =>
  ui.activeWorkspaceId === null
    ? []
    : (demoFileTreesByWorkspaceId[ui.activeWorkspaceId] ?? []),
);

const activeSection = computed<WorkspaceSectionId | null>(() =>
  typeof shell.mainView === "string" &&
  shell.mainView !== "chat" &&
  shell.mainView !== "application"
    ? shell.mainView
    : null,
);

const openFile = computed(() =>
  typeof shell.mainView === "object" ? shell.mainView : null,
);

function openFileOnCanvas(filePath: string) {
  shell.mainView = { kind: "file", filePath };
}

function sendMessage(text: string) {
  const turn = chatTurn.startTurn({
    sessionId: activeSessionId.value,
    userText: text,
  });
  if (
    activeSessionId.value === null &&
    chatTurn.activeSessionId.value !== null
  ) {
    shell.target = { sessionId: chatTurn.activeSessionId.value };
  }
  void turn;
}

function onMenuSelect(itemId: string) {
  shell.mainView = itemId === "chat" ? "chat" : (itemId as WorkspaceSectionId);
}

function openHistorySession(sessionId: string) {
  shell.target = { sessionId };
  shell.mainView = "chat";
}

function openContinuous() {
  shell.target = "continuous";
  shell.mainView = "chat";
}
</script>

<template>
  <div class="workspace-view">
    <MenuPanel
      v-if="ui.isMenuOpen"
      :title="activeWorkspace?.name ?? 'Workspace'"
      :items="WORKSPACE_MENU_ITEMS"
      :active-id="typeof shell.mainView === 'string' ? shell.mainView : ''"
      @select="onMenuSelect"
    />

    <SessionsPanel
      v-if="ui.isSessionListOpen"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :is-continuous-active="shell.target === 'continuous'"
      :is-loading="sessionsQuery.isPending.value"
      :error-text="sessionsErrorText"
      @select="openHistorySession"
      @select-continuous="openContinuous"
    />

    <div v-if="activeSection" class="canvas section-view">
      <div class="section-column">
        <WorkspaceSectionPanel
          :section="activeSection"
          :workspace-id="ui.activeWorkspaceId ?? ''"
        />
      </div>
    </div>

    <FileEditorView
      v-else-if="openFile"
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
        <EmptyState
          :title="
            activeWorkspace
              ? `${activeWorkspace.managerName ?? 'Your assistant'} is on ${activeWorkspace.name}`
              : 'Pick a workspace'
          "
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
        @decide-approval="chatTurn.decideApproval"
      />

      <footer class="composer-dock">
        <AppComposer
          :streaming="chatTurn.isStreaming.value"
          :placeholder="`Ask about ${activeWorkspace?.name ?? 'this workspace'}…`"
          @send="sendMessage"
          @interrupt="chatTurn.interrupt"
        />
      </footer>
    </section>

    <FilesPanel
      v-if="isFilesPanelOpen && !activeSection"
      :workspace-name="activeWorkspace?.name ?? 'Workspace'"
      :tree="fileTree"
      :active-file-path="openFile?.filePath ?? null"
      @close="isFilesPanelOpen = false"
      @open-file="openFileOnCanvas"
    />
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
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}

.composer-dock {
  padding: 0 24px 18px;
  max-width: 808px;
  width: 100%;
  margin: 0 auto;
}
</style>
