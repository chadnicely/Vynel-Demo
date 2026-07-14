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
import SectionHeader from "./SectionHeader.vue";
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
  <div class="flex flex-col gap-2.5">
    <SectionHeader
      :icon="BookOpen"
      title="Knowledge"
      subtitle="The vault of folders and files Claude studies and searches"
    >
      <template v-if="sources.length > 0" #actions>
        <button
          type="button"
          class="inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair bg-transparent px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="isAddOpen = true"
        >
          <Plus :size="13" />
          Add
        </button>
      </template>
    </SectionHeader>

    <div v-if="sources.length > 0" class="grid gap-1">
      <div
        v-for="source in sources"
        :key="source.id"
        class="row flex items-center gap-2.5 rounded-sm border border-hair bg-raised px-2.5 py-2"
      >
        <span
          class="grid size-[26px] shrink-0 place-items-center rounded-sm border border-hair bg-panel text-file-folder"
        >
          <FileText v-if="source.sourceKind === 'file'" :size="14" />
          <FolderOpen v-else :size="14" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="m-0 flex items-center gap-1.5 text-sm font-medium text-ink-1">
            {{ folderName(source.absolutePath) }}
            <span
              class="scope-chip inline-flex items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ scopeLabel(source.workspaceId) }}</span
            >
          </p>
          <p class="m-0 mt-px truncate text-xs text-ink-3">
            {{ source.absolutePath }} · {{ indexingSummary(source) }}
          </p>
        </div>
        <button
          type="button"
          class="grid shrink-0 cursor-default place-items-center rounded-sm p-1 text-ink-3 hover:bg-row-hover hover:text-danger"
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
        <button
          type="button"
          class="invite-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-[14px] py-[5px] text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="isAddOpen = true"
        >
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
