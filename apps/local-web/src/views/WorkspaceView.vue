<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FolderTree, Sparkles } from "lucide-vue-next";
import { EmptyState, IconButton } from "@vynel/ui";
import SessionsPanel from "../components/chat/SessionsPanel.vue";
import ThreadStream from "../components/chat/ThreadStream.vue";
import Composer from "../components/chat/Composer.vue";
import AppDrawer from "../components/shell/AppDrawer.vue";
import WorkspaceSwitcher from "../components/workspace/WorkspaceSwitcher.vue";
import FilesPanel from "../components/workspace/FilesPanel.vue";
import WorkspaceSectionPanel from "../components/workspace/WorkspaceSectionPanel.vue";
import { WORKSPACE_SECTIONS } from "../components/workspace/workspace-sections.js";
import type { WorkspaceSectionId } from "../components/workspace/workspace-sections.js";
import { useWorkspaceList } from "../composables/workspaces/use-workspace-list.js";
import { useSessionList } from "../composables/chat/use-session-list.js";
import { useSessionDetail } from "../composables/chat/use-session-detail.js";
import { useChatTurn } from "../composables/chat/use-chat-turn.js";
import type { SessionScope } from "../composables/chat/session-scope.js";
import { useUiStore } from "../stores/ui-store.js";
import { formatSdkError } from "../utils/format-sdk-error.js";
import { demoFileTreesByWorkspaceId } from "../demo/fixtures/file-trees.js";

// The workspace room: its chat, its files, its capabilities — same components
// as global chat, scoped to one workspace.
const ui = useUiStore();

const workspacesQuery = useWorkspaceList();
const workspaces = computed(() => workspacesQuery.data.value?.workspaces ?? []);

// Land on the most recently used workspace so the tab never opens dead.
watch(
  workspaces,
  (rows) => {
    if (ui.activeWorkspaceId === null && rows.length > 0) {
      ui.activeWorkspaceId = rows[0]!.id;
    }
  },
  { immediate: true },
);

const activeWorkspace = computed(
  () => workspaces.value.find((row) => row.id === ui.activeWorkspaceId) ?? null,
);

const scope = computed<SessionScope | null>(() =>
  ui.activeWorkspaceId === null
    ? null
    : { kind: "workspace", workspaceId: ui.activeWorkspaceId },
);

const selectedSessionId = ref<string | null>(null);
const isDrawerOpen = ref(false);
const isFilesPanelOpen = ref(false);
const activeSection = ref<WorkspaceSectionId | null>(null);

// Switching rooms resets the room-local selection.
watch(
  () => ui.activeWorkspaceId,
  () => {
    selectedSessionId.value = null;
    activeSection.value = null;
  },
);

const sessionsQuery = useSessionList(
  () => scope.value ?? { kind: "workspace", workspaceId: "none" },
);
const sessions = computed(() => sessionsQuery.data.value?.sessions ?? []);

const detailQuery = useSessionDetail(() => selectedSessionId.value);
const messages = computed(() => detailQuery.data.value?.messages ?? []);
const toolCallsByMessageId = computed(
  () => detailQuery.data.value?.toolCallsByMessageId ?? {},
);

const chatTurn = useChatTurn({
  scope: () => scope.value ?? { kind: "global" },
  onSessionCreated: (session) => {
    selectedSessionId.value = session.id;
  },
});

const activeTurnForSelection = computed(() =>
  chatTurn.activeSessionId.value !== null &&
  chatTurn.activeSessionId.value === selectedSessionId.value
    ? chatTurn.view.value
    : null,
);

const showsThread = computed(
  () =>
    selectedSessionId.value !== null || activeTurnForSelection.value !== null,
);

const sessionsErrorText = computed(() =>
  sessionsQuery.isError.value
    ? formatSdkError(sessionsQuery.error.value)
    : null,
);

const fileTree = computed(() =>
  ui.activeWorkspaceId === null
    ? []
    : (demoFileTreesByWorkspaceId[ui.activeWorkspaceId] ?? []),
);

function sendMessage(text: string) {
  const turn = chatTurn.startTurn({
    sessionId: selectedSessionId.value,
    userText: text,
  });
  if (selectedSessionId.value === null) {
    selectedSessionId.value = chatTurn.activeSessionId.value;
  }
  void turn;
}
</script>

<template>
  <div class="workspace-view" :class="{ 'has-files': isFilesPanelOpen }">
    <aside class="left-column">
      <div class="switcher-row">
        <WorkspaceSwitcher
          :workspaces="workspaces"
          :active-workspace-id="ui.activeWorkspaceId"
          @select="(id) => (ui.activeWorkspaceId = id)"
        />
      </div>
      <SessionsPanel
        class="sessions"
        :title="activeWorkspace?.name ?? 'Workspace'"
        :sessions="sessions"
        :active-session-id="selectedSessionId"
        :is-loading="sessionsQuery.isPending.value"
        :error-text="sessionsErrorText"
        @select="(id) => (selectedSessionId = id)"
        @new-session="selectedSessionId = null"
        @open-menu="isDrawerOpen = true"
      />
    </aside>

    <section class="thread-pane">
      <div class="thread-toolbar">
        <IconButton
          label="Toggle files"
          :active="isFilesPanelOpen"
          @click="isFilesPanelOpen = !isFilesPanelOpen"
        >
          <FolderTree :size="15" />
        </IconButton>
      </div>

      <ThreadStream
        v-if="showsThread"
        :messages="messages"
        :tool-calls-by-message-id="toolCallsByMessageId"
        :active-turn="activeTurnForSelection"
        @decide-approval="chatTurn.decideApproval"
      />
      <div v-else class="welcome">
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

      <footer class="composer-dock">
        <Composer
          :streaming="chatTurn.isStreaming.value"
          :placeholder="`Ask about ${activeWorkspace?.name ?? 'this workspace'}…`"
          @send="sendMessage"
          @interrupt="chatTurn.interrupt"
        />
      </footer>
    </section>

    <FilesPanel
      v-if="isFilesPanelOpen"
      :workspace-name="activeWorkspace?.name ?? 'Workspace'"
      :tree="fileTree"
      @close="isFilesPanelOpen = false"
    />

    <AppDrawer
      :open="isDrawerOpen"
      :title="
        activeSection === null ? (activeWorkspace?.name ?? 'Workspace') : 'Back'
      "
      @close="
        activeSection === null ? (isDrawerOpen = false) : (activeSection = null)
      "
    >
      <div v-if="activeSection === null" class="section-list">
        <button
          v-for="section in WORKSPACE_SECTIONS"
          :key="section.id"
          type="button"
          class="section-row"
          @click="activeSection = section.id"
        >
          <span class="section-label">{{ section.label }}</span>
          <span class="section-hint">{{ section.hint }}</span>
        </button>
      </div>
      <WorkspaceSectionPanel
        v-else
        :section="activeSection"
        :workspace-id="ui.activeWorkspaceId ?? ''"
      />
    </AppDrawer>
  </div>
</template>

<style scoped>
.workspace-view {
  height: 100%;
  display: grid;
  grid-template-columns: 280px 1fr;
  min-height: 0;
}

.workspace-view.has-files {
  grid-template-columns: 280px 1fr 280px;
}

.left-column {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--hair);
}

.switcher-row {
  padding: 6px;
  border-bottom: 1px solid var(--hair);
}

.sessions {
  border-right: 0;
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

.composer-dock {
  padding: 0 24px 18px;
  max-width: 808px;
  width: 100%;
  margin: 0 auto;
}

.section-list {
  display: grid;
  gap: 2px;
}

.section-row {
  appearance: none;
  border: 0;
  margin: 0;
  display: grid;
  gap: 1px;
  padding: 9px 10px;
  border-radius: var(--radius-s);
  background: transparent;
  text-align: left;
  cursor: default;
}

.section-row:hover {
  background: var(--row-hover);
}

.section-row:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.section-label {
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
}

.section-hint {
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}
</style>
