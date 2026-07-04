<script setup lang="ts">
import { ref } from "vue";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-vue-next";
import type { DemoFileNode } from "../../demo/fixtures/file-trees.js";

// Recursive tree row (self-referencing component). Demo-phase: reads the
// fixture tree; the files API swaps in a lazy directory listing later.
const props = defineProps<{
  node: DemoFileNode;
  depth: number;
}>();

const isOpen = ref(props.depth === 0);
</script>

<template>
  <div class="file-node">
    <button
      v-if="props.node.kind === 'directory'"
      type="button"
      class="row"
      :style="{ paddingLeft: `${8 + props.depth * 14}px` }"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <ChevronRight :size="12" class="caret" :class="{ 'is-open': isOpen }" />
      <FolderOpen v-if="isOpen" :size="13" class="icon" />
      <Folder v-else :size="13" class="icon" />
      <span class="name">{{ props.node.name }}</span>
    </button>

    <div
      v-else
      class="row is-file"
      :style="{ paddingLeft: `${24 + props.depth * 14}px` }"
    >
      <FileText :size="13" class="icon" />
      <span class="name">{{ props.node.name }}</span>
    </div>

    <template v-if="props.node.kind === 'directory' && isOpen">
      <FileTreeNode
        v-for="child in props.node.children ?? []"
        :key="child.name"
        :node="child"
        :depth="props.depth + 1"
      />
    </template>
  </div>
</template>

<style scoped>
.row {
  appearance: none;
  border: 0;
  margin: 0;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  background: transparent;
  border-radius: var(--radius-s);
  cursor: default;
  text-align: left;
}

.row:not(.is-file):hover {
  background: var(--row-hover);
}

.row:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.caret {
  color: var(--ink-3);
  flex: none;
  transition: transform var(--t-fast) var(--ease-out);
}

.caret.is-open {
  transform: rotate(90deg);
}

.icon {
  color: var(--ink-3);
  flex: none;
}

.name {
  color: var(--ink-2);
  font: 400 12px/1.6 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row:not(.is-file) .name {
  color: var(--ink-1);
}

@media (prefers-reduced-motion: reduce) {
  .caret {
    transition: none;
  }
}
</style>
