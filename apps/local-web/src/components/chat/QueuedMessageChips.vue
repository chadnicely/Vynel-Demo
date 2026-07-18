<script setup lang="ts">
import type { QueuedMessage } from "../../composables/chat/use-queued-send.js";

// Messages waiting for the current reply to finish — visible and removable,
// never a silent queue. Rendered by the chat views just above the composer.
const props = defineProps<{
  queued: QueuedMessage[];
}>();

const emit = defineEmits<{
  remove: [index: number];
}>();

function chipText(message: QueuedMessage): string {
  if (message.text.trim() !== "") return message.text;
  const count = message.attachments.length;
  return count === 1 ? "1 attachment" : `${count} attachments`;
}
</script>

<template>
  <div v-if="props.queued.length > 0" class="queued-strip">
    <span class="queued-note">Queued — sends when this reply finishes</span>
    <div class="queued-chips">
      <span
        v-for="(message, index) in props.queued"
        :key="`${index}-${message.text.slice(0, 24)}`"
        class="queued-chip"
      >
        <span class="queued-chip-text">{{ chipText(message) }}</span>
        <button
          type="button"
          class="queued-chip-remove"
          :aria-label="`Remove queued message: ${chipText(message)}`"
          @click="emit('remove', index)"
        >
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.queued-strip {
  display: grid;
  gap: 5px;
  padding: 0 2px 8px;
}

.queued-note {
  color: var(--ink-3);
  font: 600 10.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.queued-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.queued-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 420px;
  padding: 4px 6px 4px 11px;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  background: var(--bg-raised);
  color: var(--ink-2);
  font: 500 12px/1.5 var(--font-ui);
}

.queued-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queued-chip-remove {
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

.queued-chip-remove:hover {
  background: var(--hair);
  color: var(--ink-1);
}

.queued-chip-remove:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
