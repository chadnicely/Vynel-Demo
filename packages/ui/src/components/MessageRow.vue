<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import MarkdownText from "./MarkdownText.vue";
import ThinkingBlock from "./ThinkingBlock.vue";

const props = defineProps<{ message: ChatMessageResponse }>();

const roleLabel = computed(() => {
  if (props.message.role === "user") return "You";
  if (props.message.sourceKind === "global-root") return "Assistant · Global";
  if (props.message.sourceLabel)
    return `Assistant · ${props.message.sourceLabel}`;
  return "Assistant";
});

const isAssistant = computed(() => props.message.role === "assistant");
</script>

<template>
  <div class="message-row" :class="`role-${props.message.role}`">
    <p class="role-label">{{ roleLabel }}</p>

    <ThinkingBlock
      v-if="props.message.thinkingBody"
      :text="props.message.thinkingBody"
      class="thinking"
    />

    <MarkdownText v-if="isAssistant" :source="props.message.body" />
    <p v-else class="plain-body">{{ props.message.body }}</p>

    <p v-if="props.message.errorMessage" class="error-note">
      {{ props.message.errorMessage }}
    </p>

    <slot name="tool-calls" />
  </div>
</template>

<style scoped>
.message-row {
  display: grid;
  gap: 6px;
}

.role-label {
  margin: 0;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.role-user .role-label {
  color: var(--ink-2);
}

.plain-body {
  margin: 0;
  color: var(--ink-1);
  font: 400 13.5px/1.65 var(--font-ui);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.role-user {
  background: var(--bg-panel);
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  padding: 10px 14px;
}

.error-note {
  margin: 0;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.thinking {
  margin-bottom: 2px;
}
</style>
