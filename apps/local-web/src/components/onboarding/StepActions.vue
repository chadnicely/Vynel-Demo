<script setup lang="ts">
// Shared footer for every wizard step: one gold primary (submits the owning
// form) + an optional quiet skip. Keeps the wizard's action row identical
// across steps. `busy` is a submit in flight (both buttons wait); `disabled`
// is the step's own gate (a brain not signed in yet) — the skip stays live.
const props = defineProps<{
  primaryLabel: string;
  busy?: boolean;
  disabled?: boolean;
  skippable?: boolean;
  skipLabel?: string;
}>();

const emit = defineEmits<{
  skip: [];
}>();
</script>

<template>
  <div class="step-actions">
    <button
      v-if="props.skippable"
      type="button"
      class="skip"
      :disabled="props.busy"
      @click="emit('skip')"
    >
      {{ props.skipLabel ?? "Skip for now" }}
    </button>
    <button
      type="submit"
      class="primary"
      :disabled="props.busy || props.disabled"
    >
      {{ props.primaryLabel }}
    </button>
  </div>
</template>

<style scoped>
.step-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 14px;
  margin-top: 22px;
}

.primary {
  appearance: none;
  border: 0;
  border-radius: var(--radius-s);
  padding: 8px 22px;
  background: var(--gold);
  color: var(--color-bg);
  font: 600 13px/1.6 var(--font-ui);
  cursor: default;
  transition: background var(--t-fast) var(--ease-out);
}

.primary:hover:not(:disabled) {
  background: var(--gold-bright);
}

.primary:disabled {
  opacity: 0.55;
}

.primary:focus-visible {
  outline: 2px solid var(--gold-bright);
  outline-offset: 2px;
}

.skip {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font: 500 12.5px/1.6 var(--font-ui);
  cursor: default;
  transition: color var(--t-fast) var(--ease-out);
}

.skip:hover:not(:disabled) {
  color: var(--ink-2);
}

.skip:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
  border-radius: var(--radius-s);
}
</style>
