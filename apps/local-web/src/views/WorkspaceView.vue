<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhTreeView as FolderTree,
  PhListChecks as ListChecks,
  PhSparkle as Sparkles,
} from "@phosphor-icons/vue";
import { EmptyState, IconButton, ThreadSkeleton } from "@vynel/ui";
import ThreadStream from "../components/chat/ThreadStream.vue";
import AppComposer from "../components/chat/AppComposer.vue";
import QueuedMessageChips from "../components/chat/QueuedMessageChips.vue";
import TodoDock from "../components/chat/TodoDock.vue";
import FilesPanel from "../components/workspace/FilesPanel.vue";
import TasksPanel from "../components/tasks/TasksPanel.vue";
import FileEditorView from "../components/workspace/FileEditorView.vue";
import WorkspaceSectionPanel from "../components/workspace/WorkspaceSectionPanel.vue";
import WorkspaceCustomizeSection from "../components/customize/WorkspaceCustomizeSection.vue";
import WorkspaceWelcomeHero from "../components/workspace/WorkspaceWelcomeHero.vue";
import DisplayView from "./display/DisplayView.vue";
import type { WorkspaceSectionId } from "../components/workspace/workspace-sections.js";
import { useWorkspaceList } from "../composables/workspaces/use-workspace-list.js";
import { useWorkspaceStatuses } from "../composables/workspaces/use-workspace-status.js";
import { useSessionDetail } from "../composables/chat/use-session-detail.js";
import { useInFlightDelegations } from "../composables/delegations/use-in-flight-delegations.js";
import { buildThreadPointers } from "../components/chat/thread-pointers.js";
import { useOpenPointerTarget } from "../components/chat/open-pointer-target.js";
import {
  useContinuingConversation,
  useContinuingSessionId,
} from "../composables/chat/use-continuing-conversation.js";
import { useChatTurn } from "../composables/chat/use-chat-turn.js";
import { useWatchedTurn } from "../composables/chat/use-watched-turn.js";
import { resolveVisibleActiveTurn } from "../composables/chat/visible-active-turn.js";
import { useContextOccupancy } from "../composables/chat/use-context-occupancy.js";
import { useQueuedSend } from "../composables/chat/use-queued-send.js";
import { useReauthorizeToolCall } from "../composables/chat/use-reauthorize-tool-call.js";
import { useDecideApproval } from "../composables/approvals/use-decide-approval.js";
import type { SessionScope } from "../composables/chat/session-scope.js";
import type { TurnAttachmentInput } from "../composables/chat/turn-attachments.js";
import type { ComposerSettings } from "../composables/chat/use-session-settings.js";
import { useUiStore } from "../stores/ui-store.js";
import { useCustomizeStore } from "../stores/customize-store.js";
import { personaFaceOf } from "../utils/persona-face.js";
import { useActivityStore } from "../stores/activity-store.js";
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

const workspacesQuery = useWorkspaceList();
// Name -> id for the delivered-row workspace chips (ThreadStream).
const workspacesByName = computed(() =>
  Object.fromEntries(
    (workspacesQuery.data.value ?? []).map((workspace) => [
      workspace.name,
      workspace.id,
    ]),
  ),
);
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
const continuingSessionId = useContinuingSessionId(() => scope.value, continuingQuery);

const activeSessionId = computed<string | null>(() => {
  if (shell.target === "continuous") return continuingSessionId.value;
  if (shell.target === "fresh") return null;
  return shell.target.sessionId;
});

// A routed task streams its rows into THIS workspace's transcript in the
// background (the shared pipeline) — poll the open thread while one is in
// flight here so the task/reply/tool-calls appear live, not on refresh.
const inFlightQuery = useInFlightDelegations();
// The thread pointers (live-tracking redesign, Case 1) — UNFILTERED: a
// pointer hangs off a row this thread SENT, matched by its trace key
// (ThreadStream's received-side gate keeps target threads clean); the rail
// carries the roster.
const threadPointers = computed(() =>
  buildThreadPointers(inFlightQuery.data.value ?? []),
);
// A pointer click routes through the one-home opener.
const openPointerTarget = useOpenPointerTarget();
const hasInFlightDelegationHere = computed(() =>
  (inFlightQuery.data.value ?? []).some(
    (delegation) => delegation.workspaceId === tab.workspaceId,
  ),
);

const chatTurn = useChatTurn({
  scope: () => scope.value,
  onSessionCreated: (session) => {
    shell.target = { sessionId: session.id };
  },
  // The origin stream detaches once the thread's standing watch (the window's
  // one live socket) has the turn folding — the send holds a pool connection
  // only for its first frames; the watch renders the rest.
  detachWhen: () => watchedTurn.hasSharedFold.value,
});

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

// A turn running in THIS workspace outside this view's own stream — another
// tab's turn or a schedule fire — reported by the activity feed. Poll the
// open thread while one runs (same liveness rule as the delegation poll);
// this view's own turn renders through its stream, so it never counts.
const activity = useActivityStore();
// (`hasSharedFold`, not the rendered view: it never consults the own-overlay
// suppression, so it is safe to read at setup time.)
const hasBackgroundTurnHere = computed(
  () =>
    !chatTurn.isStreaming.value &&
    !watchedTurn.hasSharedFold.value &&
    tab.workspaceId !== null &&
    activity.hasServerTurnInWorkspace(tab.workspaceId),
);

// The scope's effective status (one status one colour, Arc 5b) — tints the
// thread's live/latest card and words the chat header's badge.
const { statusByWorkspaceId } = useWorkspaceStatuses();
const statusView = computed(() =>
  tab.workspaceId === null
    ? null
    : (statusByWorkspaceId.value[tab.workspaceId] ?? null),
);
// The canvas's header badge, worded per state ("Task 5 of 13" · "Waiting on
// your answer" · "Stopped on an error" · "All N tasks done" · "Not running").
const headerBadge = computed<{ label: string; status: string } | null>(() => {
  const view = statusView.value;
  if (view === null) return null;
  if (view.status === "needs_input")
    return { label: "Waiting on your answer", status: "needs_input" };
  if (view.status === "problem")
    return { label: "Stopped on an error", status: "problem" };
  if (view.status === "completed") {
    return {
      label:
        view.tasksTotal > 0
          ? `All ${view.tasksTotal} tasks done`
          : "All done",
      status: "completed",
    };
  }
  if (view.status === "running") {
    return {
      label:
        view.tasksTotal > 0
          ? `Task ${Math.min(view.tasksDone + 1, view.tasksTotal)} of ${view.tasksTotal}`
          : "Working now",
      status: "running",
    };
  }
  return { label: "Not running", status: "not_running" };
});
const detailQuery = useSessionDetail(
  () => scope.value,
  () => activeSessionId.value,
  () =>
    hasInFlightDelegationHere.value || hasBackgroundTurnHere.value
      ? 4000
      : false,
  // The continuous thread reads the chain-spanning transcript — a context
  // swap must never empty the visible conversation.
  () => (shell.target === "continuous" ? "continuing" : "segment"),
);
const messages = computed(() => detailQuery.data.value?.messages ?? []);
const sessionModel = computed(
  () => detailQuery.data.value?.session?.model ?? null,
);
const toolCallsByMessageId = computed(
  () => detailQuery.data.value?.toolCallsByMessageId ?? {},
);

// A BLOCKED tool card's "Run it anyway" (the provider's own safety check
// refused the call): re-issue the intent through this thread's own
// composer — same session, same settings, the same send queue.
const { composer, reauthorizeToolCall } = useReauthorizeToolCall();

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


const activeTurn = computed(
  () => ownActiveTurn.value ?? watchedTurn.view.value,
);
// The composer's "a turn is running here" — own OR watched (after the detach
// the watch is the one that knows); the Stop button reads it.
const isTurnStreaming = computed(() => activeTurn.value?.status === "streaming");
// The send queue gates on the RAW own view (not the visibility-resolved one):
// an own turn hidden behind a target switch is still running — a send must
// queue behind it, never fall through to a start the engine refuses.
const busyTurn = computed(() => chatTurn.view.value ?? watchedTurn.view.value);
// A failed turn's note survives the overlay teardown on either path.
const turnErrorText = computed(
  () => chatTurn.errorText.value ?? watchedTurn.lastTurnErrorText.value,
);

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

// "account"/"application"/"engine" are global-only — the
// workspace menu never sets them, but the type excludes them here so the
// shell union stays one shape. "customize" is workspace-only and renders its
// own canvas below.
const activeSection = computed<WorkspaceSectionId | null>(() =>
  typeof shell.mainView === "string" &&
  shell.mainView !== "chat" &&
  // Global-only like account/application: the spoken thread has no workspace.
  shell.mainView !== "voice-chat" &&
  // The Display is NOT global-only — this room has its own board — but it is
  // not a menu section either: the title-bar switch opens it, and it renders
  // its own canvas below.
  shell.mainView !== "display" &&
  shell.mainView !== "application" &&
  shell.mainView !== "account" &&
  shell.mainView !== "engine" &&
  // The local-model screens (Settings) are this computer's, never a room's.
  shell.mainView !== "embedding" &&
  shell.mainView !== "voice-settings" &&
  shell.mainView !== "customize"
    ? shell.mainView
    : null,
);

const isCustomizeOpen = computed(() => shell.mainView === "customize");
const isDisplayOpen = computed(() => shell.mainView === "display");

// The persona's face: its conversation icon, else the workspace's own logo
// (null = the Claude mark).
const customizeStore = useCustomizeStore();
const assistantIconUrl = computed(() =>
  tab.workspaceId !== null
    ? personaFaceOf(customizeStore.customizationFor(tab.workspaceId))
    : null,
);

const openFile = computed(() =>
  typeof shell.mainView === "object" ? shell.mainView : null,
);

function openFileOnCanvas(filePath: string) {
  shell.mainView = { kind: "file", filePath };
}

function sendMessage(
  text: string,
  attachments: TurnAttachmentInput[],
  settings: ComposerSettings,
) {
  // A fresh conversation's session id arrives via `session-created` — the turn's
  // onSessionCreated binds the shell to it; no synchronous binding here.
  void chatTurn.startTurn({
    sessionId: activeSessionId.value,
    isContinuous: shell.target === "continuous",
    userText: text,
    settings,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}

// Mid-turn sends queue and fire in order as each turn settles; the drain calls
// sendMessage fresh, so a queued follow-up continues the session the first
// turn just created.
const queuedSend = useQueuedSend(busyTurn, sendMessage);
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

    <!-- This room's own Display — the same board the workspace conversation's
         `display_*` tools write to, opened by the title-bar switch. It paints
         its own dark ground, so it takes the canvas whole. -->
    <div v-else-if="isDisplayOpen" class="canvas display-canvas">
      <DisplayView :scope="scope" />
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
      <!-- The canvas's 40px chat header: workspace name + the status badge
           (one status one colour) + the pane tools. -->
      <div class="thread-header">
        <span class="thread-title">{{ activeWorkspace?.name ?? "Workspace" }}</span>
        <span
          v-if="headerBadge"
          class="thread-badge"
          :data-status="headerBadge.status"
        >
          {{ headerBadge.label }}
        </span>
        <span class="thread-header-space" />
        <IconButton
          label="Toggle files"
          :active="isFilesPanelOpen"
          @click="isFilesPanelOpen = !isFilesPanelOpen"
        >
          <FolderTree :size="15" />
        </IconButton>
        <!-- The rail toggle sits with the pane tools, right after files
             (Kafi, 2026-08-15) — both open a side pane on THIS room, so they
             belong to the same cluster. -->
        <IconButton
          label="Toggle tasks"
          :active="ui.isTasksPanelOpen"
          @click="ui.isTasksPanelOpen = !ui.isTasksPanelOpen"
        >
          <ListChecks :size="15" />
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
        :pointers-by-trace-id="threadPointers"
        :workspaces-by-name="workspacesByName"
        :workspace-id="tab.workspaceId"
        :session-model="sessionModel"
        :workspace-status="statusView?.status ?? null"
        @decide-approval="onDecideApproval"
        @open-pointer="openPointerTarget"
        @reauthorize-tool-call="reauthorizeToolCall"
      />

      <footer class="composer-dock">
        <TodoDock :session-id="activeSessionId" />
        <QueuedMessageChips
          :queued="queuedSend.queued.value"
          @remove="queuedSend.removeQueued"
        />
        <p v-if="turnErrorText" class="turn-error-note">
          {{ turnErrorText }}
        </p>
        <AppComposer
          ref="composer"
          :session-id="activeSessionId"
          :streaming="isTurnStreaming"
          :placeholder="
            activeWorkspace?.managerName
              ? `Ask ${activeWorkspace.managerName} for anything…`
              : `Ask about ${activeWorkspace?.name ?? 'this workspace'}…`
          "
          :scope="scope"
          :context-fraction="occupancy.fraction.value"
          :context-tooltip="occupancy.tooltip.value"
          @send="queuedSend.submit"
          @interrupt="chatTurn.interrupt(activeSessionId)"
        />
      </footer>
    </section>

    <FilesPanel
      v-if="isFilesPanelOpen && !activeSection && !isCustomizeOpen && !isDisplayOpen"
      :workspace-name="activeWorkspace?.name ?? 'Workspace'"
      :workspace-id="tab.workspaceId ?? ''"
      :active-file-path="openFile?.filePath ?? null"
      @close="isFilesPanelOpen = false"
      @open-file="openFileOnCanvas"
    />

    <!-- Not beside the Display: the room paints its own dark ground whatever
         the app theme is, and a lit rail glued to its edge reads as breakage
         (the same call GlobalChatView makes). -->
    <TasksPanel
      v-if="ui.isTasksPanelOpen && !isDisplayOpen"
      :scope="scope"
      :assistant-name="activeWorkspace?.managerName ?? 'Assistant'"
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
  grid-template-rows: 40px 1fr auto;
  min-height: 0;
  background: var(--bg-shell);
}

/* The canvas's chat header — 40px, hairline below, name + status badge. */
.thread-header {
  display: flex;
  align-items: center;
  gap: 11.2px;
  padding: 0 22.4px;
  border-bottom: 1px solid var(--hair);
}

.thread-title {
  color: var(--ink-1);
  font: 400 13.5px/1.55 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.thread-header-space {
  flex: 1;
}

/* The status badge — the canvas's `.tag` geometry (3px/10px, radius 6px,
   weight 400, 0.02em) carrying OUR status hue: one status, one colour. */
.thread-badge {
  flex: none;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--hair);
  background: var(--bg-inset);
  color: var(--ink-2);
  font: 400 11px/1.55 var(--font-ui);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.thread-badge[data-status="running"] {
  border-color: color-mix(in srgb, var(--gold) 40%, transparent);
  color: var(--color-accent-200);
}

.thread-badge[data-status="needs_input"] {
  border-color: color-mix(in srgb, var(--needs-input) 45%, transparent);
  background: var(--needs-input-soft);
  color: var(--needs-input);
}

.thread-badge[data-status="problem"] {
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
}

.thread-badge[data-status="completed"] {
  border-color: color-mix(in srgb, var(--ok) 45%, transparent);
  background: color-mix(in srgb, var(--ok) 12%, transparent);
  color: var(--ok);
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

/* The Display owns the whole area — its own ground, its own palette. */
.display-canvas {
  display: flex;
  min-height: 0;
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

/* Full-bleed with the thread — the canvas's composer region. */
.composer-dock {
  padding: 10px var(--thread-gutter, 22.4px) 12px;
  width: 100%;
}
</style>
