<script lang="ts">
export interface SelectChipOption {
  id: string;
  label: string;
  /** Right-aligned dim annotation (a model's context window: "1M", "200K"). */
  hint?: string;
}
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

// A compact inline selector (model picker, mode picker…): a quiet text chip
// that opens a small menu. Data-blind — options in, selection out.
const props = defineProps<{
  options: SelectChipOption[];
  modelValue: string;
  /** Accessible name for the chip ("Model", "Mode"…). */
  label: string;
  /** Menus near the bottom of the screen open upward. */
  opensUp?: boolean | undefined;
  /** A second tier of options behind a collapsed expander (older models).
   *  Omitted/empty → the single flat menu (no expander, no behavior change). */
  moreOptions?: SelectChipOption[] | undefined;
  /** The expander's label. */
  moreLabel?: string | undefined;
}>();

const emit = defineEmits<{
  "update:modelValue": [id: string];
}>();

const isOpen = ref(false);
const rootElement = ref<HTMLElement | null>(null);

const moreOptions = computed(() => props.moreOptions ?? []);
// The expander auto-opens when the SELECTION lives behind it — a picked older
// model must never render as an invisible active row.
const selectedInMore = computed(() =>
  moreOptions.value.some((option) => option.id === props.modelValue),
);
const isMoreOpen = ref(false);
watch(
  [isOpen, selectedInMore],
  () => {
    if (isOpen.value) isMoreOpen.value = selectedInMore.value;
  },
  { immediate: true },
);

const selectedLabel = computed(
  () =>
    [...props.options, ...moreOptions.value].find(
      (option) => option.id === props.modelValue,
    )?.label ?? props.modelValue,
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
        <span class="row-label">{{ option.label }}</span>
        <span v-if="option.hint" class="row-hint">{{ option.hint }}</span>
      </button>

      <template v-if="moreOptions.length > 0">
        <button
          type="button"
          class="menu-row more-toggle"
          :aria-expanded="isMoreOpen"
          @click.stop="isMoreOpen = !isMoreOpen"
        >
          <span class="row-label">{{ props.moreLabel ?? "More…" }}</span>
          <svg
            class="more-chevron"
            :class="{ 'is-open': isMoreOpen }"
            width="10"
            height="10"
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
        <template v-if="isMoreOpen">
          <button
            v-for="option in moreOptions"
            :key="option.id"
            type="button"
            class="menu-row"
            :class="{ 'is-active': option.id === props.modelValue }"
            @click="select(option.id)"
          >
            <span class="row-label">{{ option.label }}</span>
            <span v-if="option.hint" class="row-hint">{{ option.hint }}</span>
          </button>
        </template>
      </template>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.row-hint {
  color: var(--ink-3);
  font: 500 10.5px/1.5 var(--font-ui);
}

.more-toggle {
  border-top: 1px solid var(--hair-strong);
  border-radius: 0 0 5px 5px;
  margin-top: 3px;
  padding-top: 7px;
  color: var(--ink-3);
}

.more-chevron {
  color: var(--ink-3);
  transition: transform 120ms ease;
}

.more-chevron.is-open {
  transform: rotate(90deg);
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
