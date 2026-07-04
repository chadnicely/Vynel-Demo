<script setup lang="ts">
import { computed } from "vue";
import { Settings2, Sparkles } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import SessionsPanel from "../components/chat/SessionsPanel.vue";
import ThreadStream from "../components/chat/ThreadStream.vue";
import Composer from "../components/chat/Composer.vue";
import MenuListView from "../components/shell/MenuListView.vue";
import { useSessionList } from "../composables/chat/use-session-list.js";
import { useSessionDetail } from "../composables/chat/use-session-detail.js";
import { useContinuingConversation } from "../composables/chat/use-continuing-conversation.js";
import { useChatTurn } from "../composables/chat/use-chat-turn.js";
import { useUiStore } from "../stores/ui-store.js";
import { formatSdkError } from "../utils/format-sdk-error.js";

// The global chat — ONE continuous conversation by default (the product's
// "one brain"). History is opt-in behind the titlebar toggle; the titlebar
// menu swaps this area for the menu view.
const GLOBAL_SCOPE = { kind: "global" } as const;

const GLOBAL_MENU_ITEMS = [
  { id: "chat", label: "Chat", hint: "Back to your conversation" },
  {
    id: "application",
    label: "Application",
    hint: "Global settings — model, voice, appearance",
  },
];

const ui = useUiStore();
const shell = ui.globalChat;

const continuingQuery = useContinuingConversation(() => GLOBAL_SCOPE);

/** The session the thread shows: continuous (default), a history pick, or none (fresh). */
const activeSessionId = computed<string | null>(() => {
  if (shell.target === "continuous")
    return continuingQuery.data.value?.currentSdkSessionId ?? null;
  if (shell.target === "fresh") return null;
  return shell.target.sessionId;
});

const sessionsQuery = useSessionList(() => GLOBAL_SCOPE);
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
  scope: () => GLOBAL_SCOPE,
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

function sendMessage(text: string) {
  const turn = chatTurn.startTurn({
    sessionId: activeSessionId.value,
    userText: text,
  });
  // A fresh conversation resolves its session synchronously — bind to it now.
  if (
    activeSessionId.value === null &&
    chatTurn.activeSessionId.value !== null
  ) {
    shell.target = { sessionId: chatTurn.activeSessionId.value };
  }
  void turn;
}

function onMenuSelect(itemId: string) {
  shell.mainView = itemId === "chat" ? "chat" : "application";
}
</script>

<template>
  <div class="chat-view" :class="{ 'has-history': ui.isSessionListOpen }">
    <SessionsPanel
      v-if="ui.isSessionListOpen"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :is-continuous-active="shell.target === 'continuous'"
      :is-loading="sessionsQuery.isPending.value"
      :error-text="sessionsErrorText"
      @select="(id) => (shell.target = { sessionId: id })"
      @select-continuous="shell.target = 'continuous'"
    />

    <MenuListView
      v-if="shell.mainView === 'menu'"
      title="Menu"
      :items="GLOBAL_MENU_ITEMS"
      @select="onMenuSelect"
    />

    <div v-else-if="shell.mainView === 'application'" class="application-view">
      <EmptyState
        title="Application"
        hint="Global settings — model, voice, appearance — land here as their options come online."
      >
        <template #icon>
          <Settings2 :size="22" />
        </template>
      </EmptyState>
    </div>

    <section v-else class="thread-pane">
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
        @decide-approval="chatTurn.decideApproval"
      />

      <footer class="composer-dock">
        <Composer
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
  display: grid;
  grid-template-columns: 1fr;
  min-height: 0;
}

.chat-view.has-history {
  grid-template-columns: 280px 1fr;
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
}

.composer-dock {
  padding: 0 24px 18px;
  max-width: 808px;
  width: 100%;
  margin: 0 auto;
}
</style>
