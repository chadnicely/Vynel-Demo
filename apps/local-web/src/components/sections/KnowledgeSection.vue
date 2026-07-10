<script setup lang="ts">
import { computed, ref } from "vue";
import { BookOpen, FileText, FolderOpen, Plus, X } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useKnowledgeSourcesInScope } from "../../composables/knowledge/use-knowledge-sources-in-scope.js";
import { useRemoveKnowledgeSource } from "../../composables/knowledge/use-remove-knowledge-source.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import AddKnowledgeDialog from "./AddKnowledgeDialog.vue";
import type { SectionScope } from "./section-scope.js";

// The knowledge vault, on either surface: the folders Claude studies. Adding
// is the point — the empty state invites the first source.
const props = defineProps<{
  scope: SectionScope;
}>();

const sourcesQuery = useKnowledgeSourcesInScope(props.scope);
const sources = computed(() => sourcesQuery.data.value ?? []);

const removeSource = useRemoveKnowledgeSource();
const { scopeLabel } = useScopeLabel();
const workspacesQuery = useWorkspaceList();

function folderName(absolutePath: string): string {
  const segments = absolutePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? absolutePath;
}

// The indexing rollup in plain words — the row must SHOW that indexing
// happened (or didn't), not sit silent.
function indexingSummary(source: {
  documentCount: number;
  indexedDocumentCount: number;
  failedDocumentCount: number;
  lastIndexedAt: string | null;
}): string {
  if (source.documentCount === 0) return "indexing…";
  const parts = [
    `${source.indexedDocumentCount} ${source.indexedDocumentCount === 1 ? "file" : "files"} indexed`,
  ];
  if (source.failedDocumentCount > 0)
    parts.push(`${source.failedDocumentCount} failed`);
  if (source.lastIndexedAt)
    parts.push(`updated ${formatRelativeTime(source.lastIndexedAt)}`);
  return parts.join(" · ");
}

// Every knowledge route anchors on a workspace: a workspace source anchors on
// its own, a global source on any (the first).
function anchorFor(source: { workspaceId: string | null }): string | null {
  if (source.workspaceId !== null) return source.workspaceId;
  if (props.scope.kind === "workspace") return props.scope.workspaceId;
  return (
    (workspacesQuery.data.value ?? []).filter((row) => !row.isArchived)[0]
      ?.id ?? null
  );
}

function remove(source: { id: string; workspaceId: string | null }) {
  const anchorWorkspaceId = anchorFor(source);
  if (anchorWorkspaceId === null) return;
  removeSource.mutate({ anchorWorkspaceId, sourceId: source.id });
}

const isAddOpen = ref(false);

function onAdded() {
  isAddOpen.value = false;
}
</script>

<template>
  <div class="knowledge-section">
    <header class="section-header">
      <BookOpen :size="15" class="section-icon" />
      <div class="section-text">
        <p class="section-title">Knowledge</p>
        <p class="section-hint">
          The vault of folders and files Claude studies and searches
        </p>
      </div>
      <button
        v-if="sources.length > 0"
        type="button"
        class="add-button"
        @click="isAddOpen = true"
      >
        <Plus :size="13" />
        Add
      </button>
    </header>

    <div v-if="sources.length > 0" class="rows">
      <div v-for="source in sources" :key="source.id" class="row">
        <span class="row-icon">
          <FileText v-if="source.sourceKind === 'file'" :size="14" />
          <FolderOpen v-else :size="14" />
        </span>
        <div class="row-main">
          <p class="row-title">
            {{ folderName(source.absolutePath) }}
            <span class="scope-chip">{{ scopeLabel(source.workspaceId) }}</span>
          </p>
          <p class="row-sub">
            {{ source.absolutePath }} · {{ indexingSummary(source) }}
          </p>
        </div>
        <button
          type="button"
          class="remove-button"
          :title="`Remove ${folderName(source.absolutePath)} from knowledge`"
          :aria-label="`Remove ${folderName(source.absolutePath)} from knowledge`"
          @click="remove(source)"
        >
          <X :size="13" />
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      title="The vault is empty"
      hint="Point Claude at a folder or a single file — notes, documents, exports — and everything readable becomes searchable knowledge."
    >
      <template #icon>
        <BookOpen :size="22" />
      </template>
      <template #action>
        <button type="button" class="invite-button" @click="isAddOpen = true">
          <Plus :size="13" />
          Add a folder or file
        </button>
      </template>
    </EmptyState>

    <AddKnowledgeDialog
      :open="isAddOpen"
      :default-scope="props.scope"
      @close="isAddOpen = false"
      @added="onAdded"
    />
  </div>
</template>

<style scoped>
.knowledge-section {
  display: grid;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 2px 4px;
}

.section-icon {
  color: var(--ink-2);
  flex: none;
  margin-top: 2px;
}

.section-text {
  min-width: 0;
  flex: 1;
}

.section-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.section-hint {
  margin: 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.add-button,
.invite-button {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 11px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: transparent;
  color: var(--ink-2);
  font: 600 11.5px/1.6 var(--font-ui);
  cursor: default;
  flex: none;
  transition: border-color var(--t-fast) var(--ease-out);
}

.invite-button {
  border-color: var(--hair-strong);
  background: var(--bg-raised);
  padding: 5px 14px;
}

.add-button:hover,
.invite-button:hover {
  color: var(--ink-1);
  border-color: var(--hair-strong);
  background: var(--row-hover);
}

.add-button:focus-visible,
.invite-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.rows {
  display: grid;
  gap: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
}

.row-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--file-folder);
  flex: none;
}

.row-main {
  min-width: 0;
  flex: 1;
}

.row-title {
  margin: 0;
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-sub {
  margin: 1px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scope-chip {
  color: var(--ink-3);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  padding: 0 6px;
}

.remove-button {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 4px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-3);
  cursor: default;
  flex: none;
}

.remove-button:hover {
  color: var(--danger);
  background: var(--row-hover);
}

.remove-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -1px;
}
</style>
