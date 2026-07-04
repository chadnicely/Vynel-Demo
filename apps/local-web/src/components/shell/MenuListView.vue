<script setup lang="ts">
// The in-place menu (Chad's model): clicking the titlebar menu icon swaps the
// chat area for this list; picking an item swaps to that item's view. "Chat"
// is always the first way back.
export interface MenuListItem {
  id: string;
  label: string;
  hint: string;
}

const props = defineProps<{
  title: string;
  items: MenuListItem[];
}>();

const emit = defineEmits<{
  select: [itemId: string];
}>();
</script>

<template>
  <div class="menu-view">
    <div class="menu-column">
      <p class="menu-title">{{ props.title }}</p>
      <button
        v-for="item in props.items"
        :key="item.id"
        type="button"
        class="menu-row"
        @click="emit('select', item.id)"
      >
        <span class="menu-label">{{ item.label }}</span>
        <span class="menu-hint">{{ item.hint }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.menu-view {
  height: 100%;
  overflow-y: auto;
}

.menu-column {
  max-width: 520px;
  margin: 0 auto;
  padding: 40px 24px;
  display: grid;
  gap: 4px;
}

.menu-title {
  margin: 0 0 10px;
  color: var(--ink-3);
  font: 600 11px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.menu-row {
  appearance: none;
  border: 1px solid var(--hair);
  margin: 0;
  display: grid;
  gap: 2px;
  padding: 12px 14px;
  border-radius: var(--radius-m);
  background: var(--bg-panel);
  text-align: left;
  cursor: default;
  transition: background var(--t-fast) var(--ease-out);
}

.menu-row:hover {
  background: var(--row-hover);
}

.menu-row:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.menu-label {
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.menu-hint {
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}
</style>
