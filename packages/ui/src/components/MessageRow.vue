<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import MarkdownText from "./MarkdownText.vue";
import ThinkingBlock from "./ThinkingBlock.vue";
import PresenceDot from "./PresenceDot.vue";

const props = withDefaults(
  defineProps<{
    message: ChatMessageResponse;
    /** True while the linked session is streaming — the chip pulses gold. */
    linkedSessionLive?: boolean | undefined;
    /** A Watch chip means "work happening on ANOTHER session" (the global thread
     *  watching a delegation). Inside the transcript where the work itself lives
     *  (the workspace chat's routed exchange) the chip is noise — pass false to
     *  suppress it. Explicit default: an absent Boolean prop casts to false, which
     *  would silently suppress every chip. */
    showWatchChip?: boolean;
  }>(),
  { linkedSessionLive: undefined, showWatchChip: true },
);

const emit = defineEmits<{
  /** The delegation chip: open the linked session's live view. */
  openSession: [sessionId: string];
}>();

// The author line comes from sourceKind (who WROTE this); sourceLabel alone
// may just name a delegation target for the chip below — never the author.
const roleLabel = computed(() => {
  if (props.message.role === "user") {
    return props.message.sourceKind === "global-root" ? "From Global" : "You";
  }
  if (props.message.sourceKind === "global-root") return "Assistant · Global";
  if (
    (props.message.sourceKind === "workspace-manager" ||
      props.message.sourceKind === "agent") &&
    props.message.sourceLabel
  ) {
    return `Assistant · ${props.message.sourceLabel}`;
  }
  return "Assistant";
});

const isAssistant = computed(() => props.message.role === "assistant");

const linkedSessionId = computed(() =>
  props.showWatchChip ? (props.message.partialSessionId ?? null) : null,
);
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

    <button
      v-if="linkedSessionId"
      type="button"
      class="session-link"
      @click="emit('openSession', linkedSessionId)"
    >
      <PresenceDot :state="props.linkedSessionLive ? 'live' : 'idle'" />
      <span class="session-link-label">
        {{
          props.message.sourceLabel
            ? `Watch ${props.message.sourceLabel}`
            : "Watch this session"
        }}
      </span>
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 4l4 4-4 4"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

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

.session-link {
  appearance: none;
  border: 1px solid var(--gold-soft);
  margin: 0;
  justify-self: start;
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

.session-link:hover {
  border-color: var(--gold);
}

.session-link:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.session-link svg {
  color: var(--ink-3);
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
