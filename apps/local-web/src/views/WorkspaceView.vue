<script setup lang="ts">
import { computed, ref } from "vue";
import { FolderTree, Sparkles } from "lucide-vue-next";
import { EmptyState, IconButton, ThreadSkeleton } from "@vynel/ui";
import ThreadStream from "../components/chat/ThreadStream.vue";
import AppComposer from "../components/chat/AppComposer.vue";
import ProcessingBanner from "../components/chat/ProcessingBanner.vue";
import QueuedMessageChips from "../components/chat/QueuedMessageChips.vue";
import TodoDock from "../components/chat/TodoDock.vue";
import FilesPanel from "../components/workspace/FilesPanel.vue";
import TasksPanel from "../components/tasks/TasksPanel.vue";
import FileEditorView from "../components/workspace/FileEditorView.vue";
import WorkspaceSectionPanel from "../components/workspace/WorkspaceSectionPanel.vue";
import WorkspaceCustomizeSection from "../components/customize/WorkspaceCustomizeSection.vue";
import WorkspaceWelcomeHero from "../components/workspace/WorkspaceWelcomeHero.vue";
import type { WorkspaceSectionId } from "../components/workspace/workspace-sections.js";
import { useWorkspaceList } from "../composables/workspaces/use-workspace-list.js";
import { useSessionDetail } from "../composables/chat/use-session-detail.js";
import { useInFlightDelegations } from "../composables/delegations/use-in-flight-delegations.js";
import { useStopDelegation } from "../composables/delegations/use-stop-delegation.js";
import { useContinuingConversation } from "../composables/chat/use-continuing-conversation.js";
import { useChatTurn } from "../composables/chat/use-chat-turn.js";
import { useWatchedTurn } from "../composables/chat/use-watched-turn.js";
import { resolveVisibleActiveTurn } from "../composables/chat/visible-active-turn.js";
import { useContextOccupancy } from "../composables/chat/use-context-occupancy.js";
import { useQueuedSend } from "../composables/chat/use-queued-send.js";
import { useDecideApproval } from "../composables/approvals/use-decide-approval.js";
import type { SessionScope } from "../composables/chat/session-scope.js";
import type { TurnAttachmentInput } from "../composables/chat/turn-attachments.js";
import { useUiStore } from "../stores/ui-store.js";
import { useCustomizeStore } from "../stores/customize-store.js";
import { useActivityStore } from "../stores/activity-store.js";
import { useActivityMonitorStore } from "../stores/activity-monitor-store.js";
import { formatSdkError } from "../utils/format-sdk-error.js";

// The workspace room — same continuous-first chat as global, scoped to one
// workspace. Panels beside the canvas: menu (persistent) · files. The shell
// keys this view per tab, so this instance binds ITS tab for its whole
// lifetime — never the "active" accessors, which flip to the next tab a beat
// before the keyed remount tears this view down. A retarget mutates the same
// tab in place (reactive); a stale-workspace tab is pruned by the shell.
const ui = useUiStore();
const tab = ui.activeTab;
const shell = tab.shell;
const activityMonitor = useActivityMonitorStore();

const workspacesQuery = useWorkspaceList();
const workspaces = computed(() => workspacesQuery.data.value ?? []);

const activeWorkspace = computed(
  () => workspaces.value.find((row) => row.id === tab.workspaceId) ?? null,
);

const scope = computed<SessionScope>(() =>
  tab.workspaceId === null
    ? { kind: "global" }
    : { kind: "workspace", workspaceId: tab.workspaceId },
);

const isFilesPanelOpen = ref(false);

const continuingQuery = useContinuingConversation(() => scope.value);

const activeSessionId = computed<string | null>(() => {
  if (shell.target === "continuous")
    return continuingQuery.data.value?.currentSdkSessionId ?? null;
  if (shell.target === "fresh") return null;
  return shell.target.sessionId;
});

// A routed task streams its rows into THIS workspace's transcript in the
// background (the shared pipeline) — poll the open thread while one is in
// flight here so the task/reply/tool-calls appear live, not on refresh.
// The banner (ProcessingBanner) shows one Watch chip per in-flight job
// targeting this workspace — closes the recorded Slice-④ gap where the chips
// appeared only on the global banner.
const inFlightQuery = useInFlightDelegations();
// The trace keys with a LIVE delegation — watch chips on matching rows pulse
// (B1: replaces the dead live-sessions store). UNFILTERED deliberately: a chip
// hangs off a row this thread SENT, matched by its own trace key — the
// workspace filter below serves the banner (work TARGETING this workspace).
const liveTraceIds = computed(() => {
  const ids = new Set<string>();
  for (const delegation of inFlightQuery.data.value ?? []) {
    if (delegation.partialSessionId != null) ids.add(delegation.partialSessionId);
  }
  return ids;
});
const inFlightDelegationsHere = computed(() =>
  (inFlightQuery.data.value ?? []).filter(
    (delegation) => delegation.workspaceId === tab.workspaceId,
  ),
);
const hasInFlightDelegationHere = computed(
  () => inFlightDelegationsHere.value.length > 0,
);
const stopDelegation = useStopDelegation();

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
    tab.workspaceId !== null &&
    activity.hasServerTurnInWorkspace(tab.workspaceId),
);
// The in-thread note for a background turn the thread is NOT rendering — a
// turn on a DIFFERENT session in this workspace. A turn on the displayed
// session streams through the watcher's overlay below, which says it better.
const backgroundTurnLabel = computed(() =>
  hasBackgroundTurnHere.value && watchedTurn.view.value === null
    ? `${activeWorkspace.value?.managerName ?? "The assistant"} is working…`
    : null,
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

// The own-turn overlay shows when the in-flight turn belongs to this thread —
// decided by the turn's ORIGIN + the user's explicit target, never a live
// query value (the mid-turn overlay flicker; see visible-active-turn.ts).
const ownActiveTurn = computed(() =>
  resolveVisibleActiveTurn({
    view: chatTurn.view.value,
    turnSessionId: chatTurn.activeSessionId.value,
    startedContinuous: chatTurn.startedContinuous.value,
    target: shell.target,
  }),
);

// The standing subscription to the displayed session's live channel — a turn
// this view does NOT own (a tab switch detached the origin stream, a schedule
// fire, a channel turn) streams here in realtime instead of crawling on the
// history poll. The own overlay always wins; the watcher renders nothing for it (render-time suppression, B3).
const watchedTurn = useWatchedTurn({
  sessionId: () => activeSessionId.value,
  isSuppressed: () => ownActiveTurn.value !== null,
  // refetch() resolves (never throws) — surface the failure so the watcher's
  // seed retries instead of silently seeding from stale cache.
  refetchDetail: async () => {
    const result = await detailQuery.refetch();
    if (result.error) throw result.error;
    return result.data ?? undefined;
  },
});

const activeTurn = computed(() => ownActiveTurn.value ?? watchedTurn.view.value);

// A cold-cache open used to flash the welcome hero over a real conversation
// while the history fetch was in flight — gate the hero behind the fetch.
const isLoadingHistory = computed(
  () => activeSessionId.value !== null && detailQuery.isPending.value,
);
const historyError = computed(() =>
  activeSessionId.value !== null && detailQuery.isError.value
    ? formatSdkError(detailQuery.error.value)
    : null,
);

const showsWelcome = computed(
  () =>
    messages.value.length === 0 &&
    activeTurn.value === null &&
    !isLoadingHistory.value &&
    historyError.value === null,
);

// The composer's context ring — settled from the sessions overview, ticking
// live on the in-flight turn's usage reports.
const occupancy = useContextOccupancy(
  () => activeSessionId.value,
  () => activeTurn.value,
);

// "account"/"application"/"engine" are global-only — the workspace menu never
// sets them, but the type excludes them here so the shell union stays one
// shape. "customize" is workspace-only and renders its own canvas below.
const activeSection = computed<WorkspaceSectionId | null>(() =>
  typeof shell.mainView === "string" &&
  shell.mainView !== "chat" &&
  shell.mainView !== "application" &&
  shell.mainView !== "account" &&
  shell.mainView !== "engine" &&
  shell.mainView !== "customize"
    ? shell.mainView
    : null,
);

const isCustomizeOpen = computed(() => shell.mainView === "customize");

// The Customize section's conversation icon (null = the Claude mark).
const customizeStore = useCustomizeStore();
const assistantIconUrl = computed(() =>
  tab.workspaceId !== null
    ? customizeStore.customizationFor(tab.workspaceId).personaImage
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
</script>

<template>
  <div class="workspace-view">
    <div v-if="activeSection" class="canvas section-view">
      <!-- Marketplace runs full-width (Chad's ask — the card grid earns the
           room); the other sections keep the deliberate narrow column. -->
      <div
        class="section-column"
        :class="{ 'is-wide': activeSection === 'marketplace' }"
      >
        <WorkspaceSectionPanel
          :section="activeSection"
          :workspace-id="tab.workspaceId ?? ''"
        />
      </div>
    </div>

    <div v-else-if="isCustomizeOpen" class="canvas section-view">
      <div class="section-column">
        <WorkspaceCustomizeSection :workspace-id="tab.workspaceId ?? ''" />
      </div>
    </div>

    <FileEditorView
      v-else-if="openFile"
      :key="openFile.filePath"
      class="canvas"
      :workspace-id="tab.workspaceId ?? ''"
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

      <ThreadSkeleton v-if="isLoadingHistory" />
      <p v-else-if="historyError" class="history-error">{{ historyError }}</p>
      <div v-else-if="showsWelcome" class="welcome">
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
      <!-- Watch chips render here too (monitor parity, Slice ④) — a routed
           exchange's rows open the same trace panel the global thread offers. -->
      <ThreadStream
        v-else
        :messages="messages"
        :tool-calls-by-message-id="toolCallsByMessageId"
        :active-turn="activeTurn"
        :assistant-name="activeWorkspace?.managerName ?? 'Assistant'"
        :assistant-icon-url="assistantIconUrl"
        :live-trace-ids="liveTraceIds"
        @decide-approval="onDecideApproval"
        @open-session="activityMonitor.openTrace"
        @open-report="(report) => (ui.viewingReport = report)"
        @watch-agent="activityMonitor.openAgentDirect"
      />

      <ProcessingBanner
        :delegations="inFlightDelegationsHere"
        :background-turn-label="backgroundTurnLabel"
        @watch="activityMonitor.openTrace"
        @stop="stopDelegation.mutate"
      />

      <footer class="composer-dock">
        <TodoDock :session-id="activeSessionId" />
        <QueuedMessageChips
          :queued="queuedSend.queued.value"
          @remove="queuedSend.removeQueued"
        />
        <p v-if="chatTurn.errorText.value" class="turn-error-note">
          {{ chatTurn.errorText.value }}
        </p>
        <AppComposer
          :streaming="chatTurn.isStreaming.value"
          :placeholder="
            activeWorkspace?.managerName
              ? `Ask ${activeWorkspace.managerName} for anything…`
              : `Ask about ${activeWorkspace?.name ?? 'this workspace'}…`
          "
          :scope="scope"
          :context-fraction="occupancy.fraction.value"
          :context-tooltip="occupancy.tooltip.value"
          @send="queuedSend.submit"
          @interrupt="chatTurn.interrupt"
        />
      </footer>
    </section>

    <FilesPanel
      v-if="isFilesPanelOpen && !activeSection && !isCustomizeOpen"
      :workspace-name="activeWorkspace?.name ?? 'Workspace'"
      :workspace-id="tab.workspaceId ?? ''"
      :active-file-path="openFile?.filePath ?? null"
      @close="isFilesPanelOpen = false"
      @open-file="openFileOnCanvas"
    />

    <TasksPanel v-if="ui.isTasksPanelOpen" :scope="scope" />
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

.history-error {
  margin: 24px auto 0;
  max-width: 968px;
  width: 100%;
  text-align: center;
  color: var(--danger);
  font: 400 12.5px/1.6 var(--font-ui);
}

.turn-error-note {
  margin: 0 0 8px;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.composer-dock {
  padding: 0 24px 18px;
  max-width: 968px;
  width: 100%;
  margin: 0 auto;
}
</style>
