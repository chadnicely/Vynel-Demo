<script lang="ts">
export interface SegmentedTab {
  id: string;
  label: string;
}
</script>

<script setup lang="ts">
const props = defineProps<{
  tabs: SegmentedTab[];
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [id: string];
}>();
</script>

<template>
  <div class="segmented-tabs" role="tablist">
    <button
      v-for="tab in props.tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="segment"
      :class="{ 'is-active': tab.id === props.modelValue }"
      :aria-selected="tab.id === props.modelValue"
      @click="emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  border: 1px solid var(--hair);
}

.segment {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 3px 14px;
  border-radius: 5px;
  background: transparent;
  color: var(--ink-2);
  font: 500 12.5px/1.6 var(--font-ui);
  cursor: default;
  transition:
    color var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out);
}

.segment:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.segment.is-active {
  color: var(--ink-1);
  background: var(--row-active);
}

.segment:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}
</style>
