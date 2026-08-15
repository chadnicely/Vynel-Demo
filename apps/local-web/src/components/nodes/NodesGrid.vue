<script setup lang="ts">
import type { SceneNode } from "../../utils/constellation-scene.js";

// The same level as cards, for reading rather than watching.
defineProps<{ nodes: readonly SceneNode[] }>();
const emit = defineEmits<{ open: [nodeId: string] }>();
</script>

<template>
  <div class="grid">
    <button
      v-for="node in nodes"
      :key="node.id"
      type="button"
      class="card"
      :class="node.status"
      @click="emit('open', node.id)"
    >
      <span class="card-face">{{ node.initials }}</span>
      <span class="card-body">
        <span class="card-name">{{ node.name }}</span>
        <span class="card-state">{{
          node.status === "building" ? "Working now" : "Nothing running"
        }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.grid {
  position: absolute;
  inset: 46px 0 0;
  overflow-y: auto;
  padding: 20px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
  align-content: start;
}
.card {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  text-align: left;
  cursor: pointer;
}
.card:hover {
  border-color: var(--hair-strong);
  background: var(--row-hover);
}
.card.building {
  border-color: var(--gold);
}
.card-face {
  flex: none;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 2px solid var(--ink-3);
  color: var(--ink-1);
  font: 700 12px var(--font-ui);
}
.card.building .card-face {
  border-color: var(--gold);
  box-shadow: 0 0 18px var(--gold-soft);
}
.card-body {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.card-name {
  color: var(--ink-1);
  font: 600 13px var(--font-ui);
}
.card-state {
  color: var(--ink-3);
  font: 400 11.5px var(--font-ui);
}
</style>
