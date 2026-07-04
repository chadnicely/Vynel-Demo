<script setup lang="ts">
import { computed, ref } from "vue";
import { Settings2, Sparkles } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import SessionsPanel from "../components/chat/SessionsPanel.vue";
import ThreadStream from "../components/chat/ThreadStream.vue";
import Composer from "../components/chat/Composer.vue";
import AppDrawer from "../components/shell/AppDrawer.vue";
import { useSessionList } from "../composables/chat/use-session-list.js";
import { useSessionDetail } from "../composables/chat/use-session-detail.js";
import { useChatTurn } from "../composables/chat/use-chat-turn.js";
import { formatSdkError } from "../utils/format-sdk-error.js";

// The global root chat — the single control surface. One conversation with
// one assistant; tasks route to workspaces and every step streams back here.
const GLOBAL_SCOPE = { kind: "global" } as const;

const selectedSessionId = ref<string | null>(null);
const isDrawerOpen = ref(false);

const sessionsQuery = useSessionList(() => GLOBAL_SCOPE);
const sessions = computed(() => sessionsQuery.data.value?.sessions ?? []);

const detailQuery = useSessionDetail(() => selectedSessionId.value);
const messages = computed(() => detailQuery.data.value?.messages ?? []);
const toolCallsByMessageId = computed(
  () => detailQuery.data.value?.toolCallsByMessageId ?? {},
);

const chatTurn = useChatTurn({
  scope: () => GLOBAL_SCOPE,
  onSessionCreated: (session) => {
    selectedSessionId.value = session.id;
  },
});

// The live turn renders only in the thread it belongs to — switching sessions
// mid-stream must not graft session A's activity under session B's history.
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

function sendMessage(text: string) {
  const turn = chatTurn.startTurn({
    sessionId: selectedSessionId.value,
    userText: text,
  });
  // startTurn resolves the session synchronously — select a brand-new one
  // right away so its live turn is visible from the first event.
  if (selectedSessionId.value === null) {
    selectedSessionId.value = chatTurn.activeSessionId.value;
  }
  void turn;
}
</script>

<template>
  <div class="chat-view">
    <SessionsPanel
      title="Chat"
      :sessions="sessions"
      :active-session-id="selectedSessionId"
      :is-loading="sessionsQuery.isPending.value"
      :error-text="sessionsErrorText"
      @select="(id) => (selectedSessionId = id)"
      @new-session="selectedSessionId = null"
      @open-menu="isDrawerOpen = true"
    />

    <section class="thread-pane">
      <ThreadStream
        v-if="showsThread"
        :messages="messages"
        :tool-calls-by-message-id="toolCallsByMessageId"
        :active-turn="activeTurnForSelection"
        @decide-approval="chatTurn.decideApproval"
      />
      <div v-else class="welcome">
        <EmptyState
          title="Your assistant is ready"
          hint="Ask for anything below — one conversation that routes work to the right workspace and shows you every step."
        >
          <template #icon>
            <Sparkles :size="22" />
          </template>
        </EmptyState>
      </div>

      <footer class="composer-dock">
        <Composer
          :streaming="chatTurn.isStreaming.value"
          placeholder="Ask your assistant for anything…"
          @send="sendMessage"
          @interrupt="chatTurn.interrupt"
        />
      </footer>
    </section>

    <AppDrawer :open="isDrawerOpen" title="Menu" @close="isDrawerOpen = false">
      <div class="drawer-item">
        <Settings2 :size="15" class="drawer-item-icon" />
        <div>
          <p class="drawer-item-title">Application</p>
          <p class="drawer-item-hint">
            Global settings — model, voice, appearance — land here as their
            options come online.
          </p>
        </div>
      </div>
    </AppDrawer>
  </div>
</template>

<style scoped>
.chat-view {
  height: 100%;
  display: grid;
  grid-template-columns: 280px 1fr;
  min-height: 0;
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

.composer-dock {
  padding: 0 24px 18px;
  max-width: 808px;
  width: 100%;
  margin: 0 auto;
}

.drawer-item {
  display: flex;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius-s);
}

.drawer-item:hover {
  background: var(--row-hover);
}

.drawer-item-icon {
  flex: none;
  margin-top: 2px;
  color: var(--ink-2);
}

.drawer-item-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
}

.drawer-item-hint {
  margin: 2px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}
</style>
