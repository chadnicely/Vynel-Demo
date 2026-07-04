<script setup lang="ts">
import { X } from "lucide-vue-next";
import { EmptyState, IconButton } from "@vynel/ui";
import type { DemoFileNode } from "../../demo/fixtures/file-trees.js";
import FileTreeNode from "./FileTreeNode.vue";

const props = defineProps<{
  workspaceName: string;
  tree: DemoFileNode[];
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <aside class="files-panel">
    <header class="panel-header">
      <p class="panel-title">Files · {{ props.workspaceName }}</p>
      <IconButton label="Close files" @click="emit('close')">
        <X :size="14" />
      </IconButton>
    </header>

    <div class="tree">
      <EmptyState
        v-if="props.tree.length === 0"
        title="No files yet"
        hint="Files your assistant creates in this workspace show up here."
      />
      <FileTreeNode
        v-for="node in props.tree"
        :key="node.name"
        :node="node"
        :depth="0"
      />
    </div>
  </aside>
</template>

<style scoped>
.files-panel {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
  width: 280px;
  background: var(--bg-panel);
  border-left: 1px solid var(--hair);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 12px;
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

.tree {
  overflow-y: auto;
  padding: 6px;
}
</style>
