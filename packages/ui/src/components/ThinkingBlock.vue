<script setup lang="ts">
// Collapsible reasoning trace. Open while streaming so the user watches the
// assistant think; collapsed once the answer starts.
const props = defineProps<{
  text: string;
  streaming?: boolean;
}>();
</script>

<template>
  <details class="thinking-block" :open="props.streaming">
    <summary class="thinking-summary">
      {{ props.streaming ? "Thinking…" : "Thought process" }}
    </summary>
    <p class="thinking-text">{{ props.text }}</p>
  </details>
</template>

<style scoped>
.thinking-block {
  border-left: 2px solid var(--hair-strong);
  padding-left: 10px;
}

.thinking-summary {
  color: var(--ink-3);
  font: 500 11.5px/1.6 var(--font-ui);
  cursor: default;
  user-select: none;
  list-style: none;
}

.thinking-summary::-webkit-details-marker {
  display: none;
}

.thinking-summary:hover {
  color: var(--ink-2);
}

.thinking-text {
  margin: 4px 0 0;
  color: var(--ink-3);
  font: 400 12px/1.6 var(--font-ui);
  font-style: italic;
  white-space: pre-wrap;
}
</style>
