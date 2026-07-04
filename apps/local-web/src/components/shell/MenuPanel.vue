<script setup lang="ts">
// The persistent menu panel (Chad's model): always a menu, sitting just
// before the conversations panel. Items render their views on the canvas —
// Chat included.
export interface MenuPanelItem {
  id: string;
  label: string;
  hint: string;
}

const props = defineProps<{
  title: string;
  items: MenuPanelItem[];
  activeId: string;
}>();

const emit = defineEmits<{
  select: [itemId: string];
}>();
</script>

<template>
  <aside class="menu-panel">
    <header class="panel-header">
      <p class="panel-title">{{ props.title }}</p>
    </header>

    <nav class="menu-list">
      <button
        v-for="item in props.items"
        :key="item.id"
        type="button"
        class="menu-row"
        :class="{ 'is-active': item.id === props.activeId }"
        @click="emit('select', item.id)"
      >
        <span class="menu-label">{{ item.label }}</span>
        <span class="menu-hint">{{ item.hint }}</span>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.menu-panel {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
  width: 220px;
  background: var(--bg-panel);
  border-right: 1px solid var(--hair);
}

.panel-header {
  display: flex;
  align-items: center;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--hair);
}

.panel-title {
  margin: 0;
  color: var(--ink-2);
  font: 600 12px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-list {
  overflow-y: auto;
  padding: 6px;
  display: grid;
  gap: 2px;
  align-content: start;
}

.menu-row {
  appearance: none;
  border: 0;
  margin: 0;
  display: grid;
  gap: 1px;
  padding: 8px 10px;
  border-radius: var(--radius-s);
  background: transparent;
  text-align: left;
  cursor: default;
}

.menu-row:hover {
  background: var(--row-hover);
}

.menu-row.is-active {
  background: var(--row-active);
}

.menu-row:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.menu-label {
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
}

.menu-row.is-active .menu-label {
  font-weight: 600;
}

.menu-hint {
  color: var(--ink-3);
  font: 400 10.5px/1.4 var(--font-ui);
}
</style>
