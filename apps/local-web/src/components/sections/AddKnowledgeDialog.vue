<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import FileSystemBrowser from "../filesystem/FileSystemBrowser.vue";
import type { FileSystemSelection } from "../filesystem/file-system-selection.js";
import { useAddKnowledgeSource } from "../../composables/knowledge/use-add-knowledge-source.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { SectionScope } from "./section-scope.js";

// Add a folder OR a single file to the knowledge vault through the shared
// Explorer-style browser: highlight a file to pick just it — otherwise the
// OPEN (or highlighted) folder is the source.
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope, never a suggestion. */
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  added: [];
}>();

const selection = ref<FileSystemSelection | null>(null);
const addSource = useAddKnowledgeSource();
const workspacesQuery = useWorkspaceList();

const workspaces = computed(() =>
  (workspacesQuery.data.value ?? []).filter((row) => !row.isArchived),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    selection.value = null;
    addSource.reset();
  },
  { immediate: true },
);

// Every knowledge route anchors on a workspace, even a GLOBAL source — from
// the Global menu that's the first workspace. No workspaces → nothing to
// anchor on, which the guard below reports.
const anchorWorkspaceId = computed(() =>
  props.defaultScope.kind === "workspace"
    ? props.defaultScope.workspaceId
    : (workspaces.value[0]?.id ?? null),
);

const canAdd = computed(
  () =>
    selection.value !== null &&
    anchorWorkspaceId.value !== null &&
    !addSource.isPending.value,
);

const errorMessage = computed(() =>
  addSource.error.value ? formatSdkError(addSource.error.value) : null,
);

function add() {
  if (!canAdd.value || selection.value === null) return;
  addSource.mutate(
    {
      anchorWorkspaceId: anchorWorkspaceId.value!,
      absolutePath: selection.value.path,
      scope: props.defaultScope.kind,
    },
    { onSuccess: () => emit("added") },
  );
}

// Modal owns Esc / backdrop / focus-trap / scroll-lock; it reports close via
// update:open, which we forward to the parent as `close`.
function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Add a folder or file to knowledge"
    description="Claude studies what you add — searchable in chat the moment it's indexed."
    size="xl"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <div class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Folder or file</span>
        <FileSystemBrowser v-model="selection" mode="any" :active="props.open" />
        <span class="text-[11px] text-ink-3">
          Click a file to add just that file — otherwise the open folder is
          what Claude studies. Double-click a folder to open it.
        </span>
      </div>

      <p
        v-if="anchorWorkspaceId === null"
        class="m-0 text-xs text-danger"
        role="alert"
      >
        Create a workspace first — knowledge indexing anchors on one.
      </p>
      <p
        v-else-if="errorMessage"
        class="m-0 text-xs text-danger"
        role="alert"
      >
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canAdd"
        @click="add"
      >
        {{ addSource.isPending.value ? "Indexing…" : "Add to knowledge" }}
      </button>
    </template>
  </Modal>
</template>
