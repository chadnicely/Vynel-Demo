<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhCaretRight as ChevronRight,
  PhFile as File,
  PhFileCode as FileCode2,
  PhBracketsCurly as FileJson,
  PhFileText as FileText,
  PhFolder as Folder,
  PhFolderOpen as FolderOpen,
  PhImage as Image,
} from "@phosphor-icons/vue";
import {
  useFileTree,
  type DirectoryEntry,
} from "../../composables/files/use-file-tree.js";
import { fileColorFamily } from "./file-colors.js";

// Recursive tree row (self-referencing component). A directory expands lazily:
// its children are fetched from the files API only once it's opened.
const props = defineProps<{
  workspaceId: string;
  entry: DirectoryEntry;
  depth: number;
  activeFilePath: string | null;
}>();

const emit = defineEmits<{
  openFile: [filePath: string];
}>();

// Closed by default — a directory fetches its children only on open, and a
// file must never enable the child query (its path isn't a directory).
const isOpen = ref(false);

const childrenQuery = useFileTree(
  () => props.workspaceId,
  () => props.entry.relativePath,
  () => isOpen.value,
);

const colorFamily = computed(() =>
  props.entry.kind === "directory"
    ? "folder"
    : fileColorFamily(props.entry.name),
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
      v-if="props.entry.kind === 'directory'"
      type="button"
      class="row"
      :style="{ paddingLeft: `${8 + props.depth * 14}px` }"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <ChevronRight :size="12" class="caret" :class="{ 'is-open': isOpen }" />
      <FolderOpen v-if="isOpen" :size="13" class="icon tone-folder" />
      <Folder v-else :size="13" class="icon tone-folder" />
      <span class="name">{{ props.entry.name }}</span>
    </button>

    <button
      v-else
      type="button"
      class="row is-file"
      :class="{ 'is-active': props.entry.relativePath === props.activeFilePath }"
      :style="{ paddingLeft: `${24 + props.depth * 14}px` }"
      @click="emit('openFile', props.entry.relativePath)"
    >
      <component
        :is="FILE_ICONS[colorFamily]"
        :size="13"
        class="icon"
        :class="`tone-${colorFamily}`"
      />
      <span class="name">{{ props.entry.name }}</span>
    </button>

    <template v-if="props.entry.kind === 'directory' && isOpen">
      <p
        v-if="childrenQuery.isPending.value"
        class="loading-row"
        :style="{ paddingLeft: `${24 + props.depth * 14}px` }"
      >
        Loading…
      </p>
      <FileTreeNode
        v-for="child in childrenQuery.data.value ?? []"
        :key="child.relativePath"
        :workspace-id="props.workspaceId"
        :entry="child"
        :depth="props.depth + 1"
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

.loading-row {
  margin: 0;
  padding-top: 3px;
  padding-bottom: 3px;
  color: var(--ink-3);
  font: 400 12px/1.6 var(--font-ui);
}

@media (prefers-reduced-motion: reduce) {
  .caret {
    transition: none;
  }
}
</style>
