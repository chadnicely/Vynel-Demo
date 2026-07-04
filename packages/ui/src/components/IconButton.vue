<script setup lang="ts">
// Chrome-level button (titlebar, panel headers). Icon comes in via the
// default slot so the library stays icon-set-agnostic.
const props = defineProps<{
  label: string;
  active?: boolean;
}>();
</script>

<template>
  <button
    type="button"
    class="icon-button"
    :class="{ 'is-active': props.active }"
    :aria-label="props.label"
    :title="props.label"
  >
    <slot />
  </button>
</template>

<style scoped>
.icon-button {
  appearance: none;
  border: 0;
  margin: 0;
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  cursor: default;
  transition:
    color var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out);
}

.icon-button:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.icon-button.is-active {
  color: var(--ink-1);
  background: var(--row-active);
}

.icon-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}
</style>
