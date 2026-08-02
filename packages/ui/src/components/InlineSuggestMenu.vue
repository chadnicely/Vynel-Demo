<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { ComposerSuggestItem } from "../lib/use-composer-suggest.js";

// The caret-anchored mention-picker menu (chat-mentions) — purely
// presentational: pre-filtered items + the roving active index come in;
// select/hover go out. Keyboard handling stays with the composer (the
// textarea keeps focus while the menu is open — combobox pattern, the
// CommandPalette's hand-rolled shape).
const props = defineProps<{
  items: ComposerSuggestItem[];
  activeIndex: number;
}>();

const emit = defineEmits<{
  select: [item: ComposerSuggestItem];
  hover: [index: number];
}>();

const listElement = ref<HTMLElement | null>(null);

type RenderRow =
  | { type: "label"; key: string; group: string }
  | { type: "item"; key: string; item: ComposerSuggestItem; index: number };

const renderRows = computed<RenderRow[]>(() => {
  const rows: RenderRow[] = [];
  let lastGroup: string | undefined;
  props.items.forEach((item, index) => {
    if (item.group && item.group !== lastGroup) {
      rows.push({ type: "label", key: `group:${item.group}`, group: item.group });
      lastGroup = item.group;
    }
    rows.push({ type: "item", key: `${item.group ?? ""}:${item.id}`, item, index });
  });
  return rows;
});

watch(
  () => props.activeIndex,
  async () => {
    await nextTick();
    listElement.value
      ?.querySelector(`[data-index="${props.activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  },
);
</script>

<template>
  <div
    ref="listElement"
    class="inline-suggest-menu"
    role="listbox"
    aria-label="Suggestions"
  >
    <template v-for="row in renderRows" :key="row.key">
      <p v-if="row.type === 'label'" class="group-label">{{ row.group }}</p>
      <button
        v-else
        type="button"
        role="option"
        :data-index="row.index"
        :aria-selected="row.index === props.activeIndex"
        class="suggest-row"
        :class="{ 'is-active': row.index === props.activeIndex }"
        @mousemove="emit('hover', row.index)"
        @mousedown.prevent
        @click="emit('select', row.item)"
      >
        <span class="row-label">{{ row.item.label }}</span>
        <span v-if="row.item.hint" class="row-hint">{{ row.item.hint }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.inline-suggest-menu {
  position: absolute;
  z-index: 40;
  min-width: 240px;
  max-width: 360px;
  max-height: 264px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  box-shadow: var(--shadow-overlay, var(--shadow-raised));
}

.group-label {
  margin: 0;
  padding: 6px 10px 2px;
  color: var(--ink-3);
  font: 600 10px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  user-select: none;
}

.suggest-row {
  appearance: none;
  border: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 10px;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-1);
  font: 400 12.5px/1.5 var(--font-ui);
  text-align: left;
  cursor: default;
}

.suggest-row.is-active {
  background: var(--row-hover);
}

.row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-hint {
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-3);
  font-size: 11px;
}
</style>
