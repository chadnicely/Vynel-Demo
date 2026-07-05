<script setup lang="ts">
import { computed } from "vue";
import { X } from "lucide-vue-next";
import { EmptyState, IconButton } from "@vynel/ui";
import { useFileTree } from "../../composables/files/use-file-tree.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import FileTreeNode from "./FileTreeNode.vue";

const props = defineProps<{
  workspaceName: string;
  workspaceId: string;
  activeFilePath: string | null;
}>();

const emit = defineEmits<{
  close: [];
  openFile: [filePath: string];
}>();

const rootQuery = useFileTree(
  () => props.workspaceId,
  () => undefined,
  () => true,
);

const entries = computed(() => rootQuery.data.value ?? []);
const errorText = computed(() =>
  rootQuery.isError.value ? formatSdkError(rootQuery.error.value) : null,
);
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
      <p v-if="errorText" class="note is-error">{{ errorText }}</p>
      <p v-else-if="rootQuery.isPending.value" class="note">Loading files…</p>
      <EmptyState
        v-else-if="entries.length === 0"
        title="No files yet"
        hint="Files your assistant creates in this workspace show up here."
      />
      <FileTreeNode
        v-for="entry in entries"
        :key="entry.relativePath"
        :workspace-id="props.workspaceId"
        :entry="entry"
        :depth="0"
        :active-file-path="props.activeFilePath"
        @open-file="(path) => emit('openFile', path)"
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

.note {
  margin: 0;
  padding: 8px 10px;
  color: var(--ink-3);
  font: 400 12px/1.6 var(--font-ui);
}

.note.is-error {
  color: var(--danger);
}
</style>
