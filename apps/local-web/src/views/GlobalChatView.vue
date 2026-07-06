<script setup lang="ts">
import { computed } from "vue";
import { Settings2, Sparkles } from "lucide-vue-next";
import { EmptyState, PresenceDot } from "@vynel/ui";
import SessionsPanel from "../components/chat/SessionsPanel.vue";
import ThreadStream from "../components/chat/ThreadStream.vue";
import AppComposer from "../components/chat/AppComposer.vue";
import MenuPanel from "../components/shell/MenuPanel.vue";
import { useSessionList } from "../composables/chat/use-session-list.js";
import { useSessionDetail } from "../composables/chat/use-session-detail.js";
import { useContinuingConversation } from "../composables/chat/use-continuing-conversation.js";
import { useChatTurn } from "../composables/chat/use-chat-turn.js";
import { useDecideApproval } from "../composables/approvals/use-decide-approval.js";
import { useInFlightDelegations } from "../composables/delegations/use-in-flight-delegations.js";
import { useUiStore } from "../stores/ui-store.js";
import { useSessionViewerStore } from "../stores/session-viewer-store.js";
import { formatSdkError } from "../utils/format-sdk-error.js";

// The global chat — ONE continuous conversation by default (the product's
// "one brain"). Panels are opt-in: the menu (persistent, leftmost) and the
// history list both sit beside the canvas, never over it.
const GLOBAL_SCOPE = { kind: "global" } as const;

const GLOBAL_MENU_ITEMS = [
  { id: "chat", label: "Chat", hint: "Your conversation" },
  { id: "application", label: "Application", hint: "Global settings" },
];

const ui = useUiStore();
const shell = ui.globalChat;
const sessionViewer = useSessionViewerStore();

const continuingQuery = useContinuingConversation(() => GLOBAL_SCOPE);

/** The session the thread shows: continuous (default), a history pick, or none (fresh). */
const activeSessionId = computed<string | null>(() => {
  if (shell.target === "continuous")
    return continuingQuery.data.value?.currentSdkSessionId ?? null;
  if (shell.target === "fresh") return null;
  return shell.target.sessionId;
});

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

const detailQuery = useSessionDetail(
  () => GLOBAL_SCOPE,
  () => activeSessionId.value,
  () => (isProcessing.value ? 4000 : false),
);
const messages = computed(() => detailQuery.data.value?.messages ?? []);
const toolCallsByMessageId = computed(
  () => detailQuery.data.value?.toolCallsByMessageId ?? {},
);

const chatTurn = useChatTurn({
  scope: () => GLOBAL_SCOPE,
  onSessionCreated: (session) => {
    shell.target = { sessionId: session.id };
  },
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

const activeTurn = computed(() =>
  chatTurn.activeSessionId.value !== null &&
  chatTurn.activeSessionId.value === activeSessionId.value
    ? chatTurn.view.value
    : null,
);

const showsWelcome = computed(
  () => messages.value.length === 0 && activeTurn.value === null,
);

function sendMessage(text: string) {
  // A fresh conversation's session id arrives via `session-created` — the turn's
  // onSessionCreated binds the shell to it; no synchronous binding here.
  void chatTurn.startTurn({
    sessionId: activeSessionId.value,
    isContinuous: shell.target === "continuous",
    userText: text,
  });
}

function onMenuSelect(itemId: string) {
  shell.mainView = itemId === "application" ? "application" : "chat";
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
  <div class="chat-view">
    <MenuPanel
      v-if="ui.isMenuOpen"
      title="Menu"
      :items="GLOBAL_MENU_ITEMS"
      :active-id="shell.mainView === 'chat' ? 'chat' : 'application'"
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

    <section v-else class="canvas thread-pane">
      <div v-if="showsWelcome" class="welcome">
        <EmptyState
          title="Your assistant is ready"
          hint="Ask for anything below — one continuous conversation that routes work to the right workspace and shows you every step."
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
        @decide-approval="onDecideApproval"
        @open-session="sessionViewer.open"
      />

      <div v-if="isProcessing" class="processing-banner">
        <template
          v-for="(delegation, index) in inFlightDelegations"
          :key="delegation.partialSessionId ?? `in-flight-${index}`"
        >
          <button
            v-if="delegation.partialSessionId"
            type="button"
            class="processing-chip"
            @click="sessionViewer.open(delegation.partialSessionId)"
          >
            <PresenceDot state="live" />
            <span>Working in {{ delegation.workspaceName }}…</span>
            <span class="processing-chip-cta">Watch</span>
          </button>
          <span v-else class="processing-chip is-static">
            <PresenceDot state="live" />
            <span>Working in {{ delegation.workspaceName }}…</span>
          </span>
        </template>
      </div>

      <footer class="composer-dock">
        <AppComposer
          :streaming="chatTurn.isStreaming.value"
          placeholder="Ask your assistant for anything…"
          @send="sendMessage"
          @interrupt="chatTurn.interrupt"
        />
      </footer>
    </section>
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

.thread-pane {
  display: grid;
  grid-template-rows: 1fr auto;
  min-height: 0;
  background: var(--bg-shell);
}

.welcome {
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

.processing-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 808px;
  width: 100%;
  margin: 0 auto;
  padding: 4px 24px 8px;
}

/* One pill per in-flight delegation — the live sibling of the report's
   "Watch X" chip (MessageRow .session-link): clicking opens the same trace
   panel while the task is still running. */
.processing-chip {
  appearance: none;
  border: 1px solid var(--gold-soft);
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 99px;
  background: var(--gold-soft);
  color: var(--ink-1);
  font: 600 11.5px/1.5 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.processing-chip:not(.is-static):hover {
  border-color: var(--gold);
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
  max-width: 808px;
  width: 100%;
  margin: 0 auto;
}
</style>
