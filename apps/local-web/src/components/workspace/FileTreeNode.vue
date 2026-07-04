<script setup lang="ts">
import { computed, ref } from "vue";
import {
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Image,
} from "lucide-vue-next";
import type { DemoFileNode } from "../../demo/fixtures/file-trees.js";
import { fileColorFamily } from "./file-colors.js";

// Recursive tree row (self-referencing component). Demo-phase: reads the
// fixture tree; the files API swaps in a lazy directory listing later.
const props = defineProps<{
  node: DemoFileNode;
  depth: number;
  /** "/"-joined path of the parent directory ("" at the root). */
  parentPath: string;
  activeFilePath: string | null;
}>();

const emit = defineEmits<{
  openFile: [filePath: string];
}>();

const isOpen = ref(props.depth === 0);

const nodePath = computed(() =>
  props.parentPath === ""
    ? props.node.name
    : `${props.parentPath}/${props.node.name}`,
);

const colorFamily = computed(() =>
  props.node.kind === "directory" ? "folder" : fileColorFamily(props.node.name),
);

const FILE_ICONS = {
  folder: Folder,
  doc: FileText,
  data: FileJson,
  image: Image,
  code: FileCode2,
  plain: File,
} as const;
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
      <FolderOpen v-if="isOpen" :size="13" class="icon tone-folder" />
      <Folder v-else :size="13" class="icon tone-folder" />
      <span class="name">{{ props.node.name }}</span>
    </button>

    <button
      v-else
      type="button"
      class="row is-file"
      :class="{ 'is-active': nodePath === props.activeFilePath }"
      :style="{ paddingLeft: `${24 + props.depth * 14}px` }"
      @click="emit('openFile', nodePath)"
    >
      <component
        :is="FILE_ICONS[colorFamily]"
        :size="13"
        class="icon"
        :class="`tone-${colorFamily}`"
      />
      <span class="name">{{ props.node.name }}</span>
    </button>

    <template v-if="props.node.kind === 'directory' && isOpen">
      <FileTreeNode
        v-for="child in props.node.children ?? []"
        :key="child.name"
        :node="child"
        :depth="props.depth + 1"
        :parent-path="nodePath"
        :active-file-path="props.activeFilePath"
        @open-file="(path) => emit('openFile', path)"
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

.row:hover {
  background: var(--row-hover);
}

.row.is-active {
  background: var(--row-active);
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
  flex: none;
}

.tone-folder {
  color: var(--file-folder);
}

.tone-doc {
  color: var(--file-doc);
}

.tone-data {
  color: var(--file-data);
}

.tone-image {
  color: var(--file-image);
}

.tone-code {
  color: var(--file-code);
}

.tone-plain {
  color: var(--ink-3);
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

.row.is-active .name {
  color: var(--ink-1);
}

@media (prefers-reduced-motion: reduce) {
  .caret {
    transition: none;
  }
}
</style>
