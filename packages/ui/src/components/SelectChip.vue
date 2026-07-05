<script lang="ts">
export interface SelectChipOption {
  id: string;
  label: string;
}
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

// A compact inline selector (model picker, mode picker…): a quiet text chip
// that opens a small menu. Data-blind — options in, selection out.
const props = defineProps<{
  options: SelectChipOption[];
  modelValue: string;
  /** Accessible name for the chip ("Model", "Mode"…). */
  label: string;
  /** Menus near the bottom of the screen open upward. */
  opensUp?: boolean | undefined;
}>();

const emit = defineEmits<{
  "update:modelValue": [id: string];
}>();

const isOpen = ref(false);
const rootElement = ref<HTMLElement | null>(null);

const selectedLabel = computed(
  () =>
    props.options.find((option) => option.id === props.modelValue)?.label ??
    props.modelValue,
);

function select(id: string) {
  isOpen.value = false;
  emit("update:modelValue", id);
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!isOpen.value) return;
  if (rootElement.value?.contains(event.target as Node)) return;
  isOpen.value = false;
}

onMounted(() =>
  document.addEventListener("pointerdown", onDocumentPointerDown),
);
onUnmounted(() =>
  document.removeEventListener("pointerdown", onDocumentPointerDown),
);
</script>

<template>
  <div ref="rootElement" class="select-chip">
    <button
      type="button"
      class="chip"
      :aria-label="props.label"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <span class="chip-label">{{ selectedLabel }}</span>
      <svg
        class="chevron"
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 6l4 4 4-4"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <div v-if="isOpen" class="menu" :class="{ 'opens-up': props.opensUp }">
      <button
        v-for="option in props.options"
        :key="option.id"
        type="button"
        class="menu-row"
        :class="{ 'is-active': option.id === props.modelValue }"
        @click="select(option.id)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.select-chip {
  position: relative;
}

.chip {
  appearance: none;
  border: 0;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  font: 500 11.5px/1.5 var(--font-ui);
  cursor: default;
}

.chip:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.chip:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.chevron {
  color: var(--ink-3);
  flex: none;
}

.menu {
  position: absolute;
  left: 0;
  top: calc(100% + 4px);
  z-index: 30;
  min-width: 150px;
  background: var(--bg-raised);
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  box-shadow: var(--shadow-overlay);
  padding: 4px;
  display: grid;
  gap: 1px;
}

.menu.opens-up {
  top: auto;
  bottom: calc(100% + 4px);
}

.menu-row {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 5px 9px;
  border-radius: 5px;
  background: transparent;
  color: var(--ink-2);
  font: 500 12px/1.5 var(--font-ui);
  text-align: left;
  cursor: default;
  white-space: nowrap;
}

.menu-row:hover {
  background: var(--row-hover);
  color: var(--ink-1);
}

.menu-row.is-active {
  background: var(--row-active);
  color: var(--ink-1);
}

.menu-row:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}
</style>
