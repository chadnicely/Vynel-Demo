<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { Settings2 } from "lucide-vue-next";
import { EmptyState, PresenceDot, workspaceAccentVar } from "@vynel/ui";
import SessionsPanel from "../components/chat/SessionsPanel.vue";
import ThreadStream from "../components/chat/ThreadStream.vue";
import AppComposer from "../components/chat/AppComposer.vue";
import QueuedMessageChips from "../components/chat/QueuedMessageChips.vue";
import GlobalWelcomeHero from "../components/chat/GlobalWelcomeHero.vue";
import AccountSection from "../components/sections/AccountSection.vue";
import AgentsSection from "../components/sections/AgentsSection.vue";
import ChannelsSection from "../components/sections/ChannelsSection.vue";
import KnowledgeSection from "../components/sections/KnowledgeSection.vue";
import LockedFeatureCard from "../components/sections/LockedFeatureCard.vue";
import MarketplaceSection from "../components/sections/MarketplaceSection.vue";
import MemorySection from "../components/sections/MemorySection.vue";
import NotebookSection from "../components/sections/NotebookSection.vue";
import SchedulesSection from "../components/sections/SchedulesSection.vue";
import SshServersSection from "../components/sections/SshServersSection.vue";
import TasksSection from "../components/sections/TasksSection.vue";
import TasksPanel from "../components/tasks/TasksPanel.vue";
import { useChannels } from "../composables/channels/use-channels.js";
import { useHubFeatures } from "../composables/hub/use-hub-features.js";
import { useSessionList } from "../composables/chat/use-session-list.js";
import { useSessionDetail } from "../composables/chat/use-session-detail.js";
import { useContinuingConversation } from "../composables/chat/use-continuing-conversation.js";
import { useChatTurn } from "../composables/chat/use-chat-turn.js";
import { useQueuedSend } from "../composables/chat/use-queued-send.js";
import { useDecideApproval } from "../composables/approvals/use-decide-approval.js";
import { useInFlightDelegations } from "../composables/delegations/use-in-flight-delegations.js";
import { useStopDelegation } from "../composables/delegations/use-stop-delegation.js";
import type { TurnAttachmentInput } from "../composables/chat/turn-attachments.js";
import { useWorkspaceList } from "../composables/workspaces/use-workspace-list.js";
import { useCurrentUser } from "../composables/users/use-current-user.js";
import { useUiStore } from "../stores/ui-store.js";
import { useActivityStore } from "../stores/activity-store.js";
import { useSessionViewerStore } from "../stores/session-viewer-store.js";
import { formatSdkError } from "../utils/format-sdk-error.js";
import { firstNameOf } from "../utils/greeting.js";

// The global chat — ONE continuous conversation by default (the product's
// "one brain"). Panels are opt-in: the menu (persistent, leftmost) and the
// history list both sit beside the canvas, never over it.
const GLOBAL_SCOPE = { kind: "global" } as const;

// The assistant presents itself by name (hero wordmark, thread labels). It IS
// Claude — the product never brands over it. One constant today; a
// configurable persona later.
const ASSISTANT_NAME = "Claude";

/** The global menu items that render a feature section on the canvas. */
const GLOBAL_SECTION_IDS = [
  "channels",
  "schedules",
  "tasks",
  "ssh-servers",
  "knowledge",
  "memory",
  "notebook",
  "marketplace",
  "agents",
  "account",
] as const;
type GlobalSectionId = (typeof GLOBAL_SECTION_IDS)[number];

function isGlobalSection(view: unknown): view is GlobalSectionId {
  return GLOBAL_SECTION_IDS.includes(view as GlobalSectionId);
}

const ui = useUiStore();
const shell = ui.globalChat;
const sessionViewer = useSessionViewerStore();

// Tier gating: a locked section renders the upgrade card in place of its
// component — the menu item stays visible, so the lock is discoverable.
const { isLocked } = useHubFeatures();

const continuingQuery = useContinuingConversation(() => GLOBAL_SCOPE);

/** The session the thread shows: continuous (default), a history pick, or none (fresh). */
const activeSessionId = computed<string | null>(() => {
  if (shell.target === "continuous")
    return continuingQuery.data.value?.currentSdkSessionId ?? null;
  if (shell.target === "fresh") return null;
  return shell.target.sessionId;
});

// The channels the assistant is reachable on (global-scoped only — the global
// chat is the brain, not a workspace). Voice is added by the hero itself.
const channelsQuery = useChannels(true);
const globalChannels = computed(() =>
  (channelsQuery.data.value ?? []).filter((row) => row.workspaceId === null),
);

// The workspaces the assistant runs — shown on the hero's command deck, each
// wearing its accent color with its manager persona.
const workspacesQuery = useWorkspaceList();
const activeWorkspaces = computed(() =>
  (workspacesQuery.data.value ?? []).filter(
    (workspace) => !workspace.isArchived,
  ),
);

const currentUserQuery = useCurrentUser();
const userFirstName = computed(() =>
  firstNameOf(currentUserQuery.data.value?.displayName),
);

const router = useRouter();

function openWorkspace(workspaceId: string) {
  ui.activeWorkspaceId = workspaceId;
  void router.push({ name: "workspace" });
}

const sessionsQuery = useSessionList(() => GLOBAL_SCOPE);
const sessions = computed(() => sessionsQuery.data.value ?? []);
const sessionsErrorText = computed(() =>
  sessionsQuery.isError.value
    ? formatSdkError(sessionsQuery.error.value)
    : null,
);

// A routed task runs in the background and pushes its report into this thread
// on completion — there is no server push, so poll while any delegation is
// in flight (and keep the thread live) so the report surfaces within seconds.
// Each in-flight row carries its correlation key, so the banner chip opens the
// SAME live trace panel the report's "Watch X" chip does — while the task runs,
// not only after it completes (the viewer's own poll fills the trace in live).
const inFlightQuery = useInFlightDelegations();
const inFlightDelegations = computed(() => inFlightQuery.data.value ?? []);
const isProcessing = computed(() => inFlightDelegations.value.length > 0);
const stopDelegation = useStopDelegation();

/** The banner chip names the actual work — "vynel · Set up the login page" —
 *  falling back to the old generic line when the task text was empty. */
function delegationChipLabel(delegation: {
  workspaceName: string;
  taskLabel: string;
}): string {
  return delegation.taskLabel
    ? `${delegation.workspaceName} · ${delegation.taskLabel}`
    : `Working in ${delegation.workspaceName}…`;
}

const chatTurn = useChatTurn({
  scope: () => GLOBAL_SCOPE,
  onSessionCreated: (session) => {
    shell.target = { sessionId: session.id };
  },
});

// A global turn running OUTSIDE this view's own stream — a Telegram/voice
// turn, another tab — reported by the activity feed. While one runs, the
// thread polls live below (rows persist per chunk) and the banner names the
// origin. This view's own turn renders through its stream, so it never
// counts here.
const activity = useActivityStore();
const backgroundTurnLabel = computed(() => {
  if (!activity.hasGlobalServerTurn || chatTurn.isStreaming.value) return null;
  switch (activity.globalServerTurnOrigin) {
    case "telegram":
      return "Replying on Telegram…";
    case "discord":
      return "Replying on Discord…";
    case "voice":
      return "Answering by voice…";
    default:
      return "Working…";
  }
});

const detailQuery = useSessionDetail(
  () => GLOBAL_SCOPE,
  () => activeSessionId.value,
  () => (isProcessing.value || backgroundTurnLabel.value !== null ? 4000 : false),
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

function openContinuous() {
  shell.target = "continuous";
  shell.mainView = "chat";
}
</script>

<template>
  <div class="chat-view">
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

    <div
      v-if="shell.mainView === 'application'"
      class="canvas application-view"
    >
      <EmptyState
        title="Application"
        hint="Global settings — model, voice, appearance — land here as their options come online."
      >
        <template #icon>
          <Settings2 :size="22" />
        </template>
      </EmptyState>
    </div>

    <div
      v-else-if="isGlobalSection(shell.mainView)"
      class="canvas section-view"
    >
      <!-- Marketplace runs full-width (Chad's ask — the card grid earns the
           room); the other sections keep the deliberate narrow column. -->
      <div
        class="section-column"
        :class="{ 'is-wide': shell.mainView === 'marketplace' }"
      >
        <ChannelsSection
          v-if="shell.mainView === 'channels'"
          :scope="{ kind: 'global' }"
        />
        <template v-else-if="shell.mainView === 'schedules'">
          <LockedFeatureCard
            v-if="isLocked('schedules')"
            feature-label="Schedules"
          />
          <SchedulesSection v-else :scope="{ kind: 'global' }" />
        </template>
        <!-- Tasks is core assistant plumbing (like notebook) — no tier gate. -->
        <TasksSection
          v-else-if="shell.mainView === 'tasks'"
          :scope="{ kind: 'global' }"
        />
        <template v-else-if="shell.mainView === 'ssh-servers'">
          <LockedFeatureCard
            v-if="isLocked('ssh')"
            feature-label="Servers"
          />
          <SshServersSection v-else :scope="{ kind: 'global' }" />
        </template>
        <template v-else-if="shell.mainView === 'knowledge'">
          <LockedFeatureCard
            v-if="isLocked('knowledge')"
            feature-label="Knowledge"
          />
          <KnowledgeSection v-else :scope="{ kind: 'global' }" />
        </template>
        <AccountSection v-else-if="shell.mainView === 'account'" />
        <!-- Notebook is core assistant guidance — no tier gate. -->
        <NotebookSection
          v-else-if="shell.mainView === 'notebook'"
          :scope="{ kind: 'global' }"
        />
        <template v-else-if="shell.mainView === 'marketplace'">
          <LockedFeatureCard
            v-if="isLocked('marketplace')"
            feature-label="Marketplace"
          />
          <MarketplaceSection v-else :scope="{ kind: 'global' }" />
        </template>
        <!-- Agents (like notebook): core delegation surface — no tier gate. -->
        <AgentsSection
          v-else-if="shell.mainView === 'agents'"
          :scope="{ kind: 'global' }"
        />
        <LockedFeatureCard
          v-else-if="isLocked('memory')"
          feature-label="Memory"
        />
        <MemorySection v-else :scope="{ kind: 'global' }" />
      </div>
    </div>

    <section v-else class="canvas thread-pane">
      <div v-if="showsWelcome" class="welcome">
        <GlobalWelcomeHero
          :assistant-name="ASSISTANT_NAME"
          :user-first-name="userFirstName"
          :channels="globalChannels"
          :workspaces="activeWorkspaces"
          @open-workspace="openWorkspace"
        />
      </div>
      <ThreadStream
        v-else
        class="thread-slot"
        :messages="messages"
        :tool-calls-by-message-id="toolCallsByMessageId"
        :active-turn="activeTurn"
        :assistant-name="ASSISTANT_NAME"
        @decide-approval="onDecideApproval"
        @open-session="sessionViewer.open"
      />

      <div
        v-if="isProcessing || backgroundTurnLabel"
        class="processing-banner"
      >
        <span v-if="backgroundTurnLabel" class="processing-chip is-static">
          <PresenceDot state="live" />
          <span>{{ backgroundTurnLabel }}</span>
        </span>
        <template
          v-for="(delegation, index) in inFlightDelegations"
          :key="delegation.partialSessionId ?? `in-flight-${index}`"
        >
          <span
            v-if="delegation.partialSessionId"
            class="processing-chip"
            :style="{
              '--accent': workspaceAccentVar(delegation.workspaceName),
            }"
          >
            <button
              type="button"
              class="processing-chip-main"
              @click="sessionViewer.open(delegation.partialSessionId)"
            >
              <PresenceDot state="live" />
              <span class="processing-chip-label">{{
                delegationChipLabel(delegation)
              }}</span>
              <span class="processing-chip-cta">Watch</span>
            </button>
            <button
              type="button"
              class="processing-chip-stop"
              :aria-label="`Stop: ${delegationChipLabel(delegation)}`"
              @click="stopDelegation.mutate(delegation.partialSessionId)"
            >
              <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          </span>
          <span v-else class="processing-chip is-static">
            <PresenceDot state="live" />
            <span class="processing-chip-label">{{
              delegationChipLabel(delegation)
            }}</span>
          </span>
        </template>
      </div>

      <footer class="composer-dock">
        <QueuedMessageChips
          :queued="queuedSend.queued.value"
          @remove="queuedSend.removeQueued"
        />
        <AppComposer
          :streaming="chatTurn.isStreaming.value"
          :placeholder="`Ask ${ASSISTANT_NAME} for anything…`"
          @send="queuedSend.submit"
          @interrupt="chatTurn.interrupt"
        />
      </footer>
    </section>

    <TasksPanel v-if="ui.isTasksPanelOpen" />
  </div>
</template>

<style scoped>
.chat-view {
  height: 100%;
  display: flex;
  min-height: 0;
}

.chat-view > :not(.canvas) {
  flex: none;
}

.canvas {
  flex: 1;
  min-width: 0;
}

/* The thread owns the canvas — no chrome above it (Chad's call: the hero
   carries channels/workspaces on the empty state; a flowing thread is just
   the conversation). */
.thread-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-shell);
}

.thread-slot {
  flex: 1;
  min-height: 0;
}

.welcome {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow-y: auto;
}

.application-view {
  display: grid;
  place-items: center;
  overflow-y: auto;
  background: var(--bg-shell);
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

.processing-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 968px;
  width: 100%;
  margin: 0 auto;
  padding: 4px 24px 8px;
}

/* One pill per in-flight delegation — the live sibling of the report's
   "Watch X" chip (MessageRow .session-link): clicking opens the same trace
   panel while the task is still running. */
.processing-chip {
  appearance: none;
  border: 1px solid
    color-mix(in srgb, var(--accent, var(--gold)) 38%, transparent);
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--accent, var(--gold)) 12%, transparent);
  color: var(--ink-1);
  font: 600 11.5px/1.5 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

/* Task labels can run long — the chip stays one line and ellipsizes. */
.processing-chip-label {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The chip splits into Watch (the body) + Stop (the square) — both plain
   buttons inside the pill so no button ever nests in a button. */
.processing-chip-main {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  font: inherit;
  cursor: default;
}

.processing-chip-stop {
  appearance: none;
  border: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 99px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}

.processing-chip-stop:hover {
  background: color-mix(in srgb, var(--danger) 15%, transparent);
  color: var(--danger);
}

.processing-chip-stop:focus-visible {
  outline: 2px solid var(--accent, var(--gold));
  outline-offset: 1px;
}

.processing-chip:not(.is-static):hover {
  border-color: var(--accent, var(--gold));
}

.processing-chip.is-static {
  background: transparent;
  border-color: transparent;
  color: var(--ink-2);
  font-weight: 500;
}

.processing-chip-cta {
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.composer-dock {
  padding: 0 24px 18px;
  max-width: 968px;
  width: 100%;
  margin: 0 auto;
}
</style>
