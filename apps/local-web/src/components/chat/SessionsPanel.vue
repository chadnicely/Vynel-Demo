<script setup lang="ts">
import { MessageCircle } from "lucide-vue-next";
import type { ChatSessionResponse } from "@vynel/contracts/chat/chat-http";
import { EmptyState } from "@vynel/ui";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

// The opt-in history list (hidden by default — chat IS the one continuous
// conversation). The pinned row returns to that ongoing thread.
const props = defineProps<{
  sessions: ChatSessionResponse[];
  /** The highlighted history session, or null when the continuous thread is active. */
  activeSessionId: string | null;
  isContinuousActive?: boolean;
  isLoading?: boolean;
  errorText?: string | null;
}>();

const emit = defineEmits<{
  select: [sessionId: string];
  selectContinuous: [];
}>();
</script>

<template>
  <aside class="sessions-panel">
    <header class="panel-header">
      <p class="panel-title">Conversations</p>
    </header>

    <div class="session-list">
      <button
        type="button"
        class="session-row is-pinned"
        :class="{ 'is-active': props.isContinuousActive }"
        @click="emit('selectContinuous')"
      >
        <span class="session-title pinned-title">
          <MessageCircle :size="13" />
          Current conversation
        </span>
        <span class="session-preview">The ongoing thread — always here.</span>
      </button>

      <p v-if="props.isLoading" class="loading-note">Loading history…</p>

      <p v-else-if="props.errorText" class="error-note">
        {{ props.errorText }}
      </p>

      <EmptyState
        v-else-if="props.sessions.length === 0"
        title="No past conversations"
        hint="Finished topics land here."
      />

      <button
        v-for="session in props.sessions"
        :key="session.id"
        type="button"
        class="session-row"
        :class="{
          'is-active':
            !props.isContinuousActive && session.id === props.activeSessionId,
        }"
        @click="emit('select', session.id)"
      >
        <span class="session-title">{{ session.title }}</span>
        <span v-if="session.lastMessagePreview" class="session-preview">
          {{ session.lastMessagePreview }}
        </span>
        <span class="session-time">{{
          formatRelativeTime(session.lastMessageAt)
        }}</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sessions-panel {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--hair);
}

.panel-header {
  display: flex;
  align-items: center;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--hair);
}

.panel-title {
  margin: 0;
  color: var(--ink-2);
  font: 600 12px/1.5 var(--font-ui);
}

.session-list {
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.loading-note {
  margin: 16px 0 0;
  text-align: center;
  color: var(--ink-3);
  font: 400 12px/1.5 var(--font-ui);
}

.error-note {
  margin: 16px 8px 0;
  text-align: center;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.session-row {
  appearance: none;
  border: 0;
  margin: 0;
  display: grid;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--radius-s);
  background: transparent;
  text-align: left;
  cursor: default;
}

.session-row.is-pinned {
  border: 1px solid var(--hair);
  background: var(--bg-raised);
  margin-bottom: 6px;
}

.session-row:hover {
  background: var(--row-hover);
}

.session-row.is-active {
  background: var(--row-active);
}

.session-row.is-pinned.is-active {
  border-color: var(--gold-soft);
  background: var(--gold-soft);
}

.session-row:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.session-title {
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pinned-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-preview {
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-time {
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
}
</style>
