<script setup lang="ts">
// An empty screen is an invitation to act — title says what this place is,
// hint says what to do about it.
const props = defineProps<{
  title: string;
  hint?: string;
}>();
</script>

<template>
  <div class="empty-state">
    <div v-if="$slots.icon" class="empty-icon">
      <slot name="icon" />
    </div>
    <p class="empty-title">{{ props.title }}</p>
    <p v-if="props.hint" class="empty-hint">{{ props.hint }}</p>
    <div v-if="$slots.action" class="empty-action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 48px 24px;
  text-align: center;
}

.empty-icon {
  color: var(--ink-3);
  margin-bottom: 6px;
}

.empty-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 15px/1.5 var(--font-ui);
}

.empty-hint {
  margin: 0;
  max-width: 42ch;
  color: var(--ink-2);
  font: 400 12.5px/1.6 var(--font-ui);
}

.empty-action {
  margin-top: 10px;
}
</style>
