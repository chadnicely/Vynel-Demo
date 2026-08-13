<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PhArrowUp as ArrowUp,
  PhFileText as FileText,
  PhFolder as Folder,
  PhHardDrive as HardDrive,
} from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";
import { useDirectoryListing } from "../../composables/workspaces/use-directory-listing.js";
import { useAddKnowledgeSource } from "../../composables/knowledge/use-add-knowledge-source.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { SectionScope } from "./section-scope.js";

// Add a folder OR a single file to the knowledge vault: walk the real
// filesystem, click a file to pick just it — otherwise the OPEN folder is the
// selection (the workspace-dialog convention).
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope, never a suggestion. */
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  added: [];
}>();

// null = the API's default start (the user's home directory).
const browsePath = ref<string | null>(null);
// A clicked file wins over the open folder; navigating clears it.
const selectedFilePath = ref<string | null>(null);

const isOpen = computed(() => props.open);
const listingQuery = useDirectoryListing(browsePath, isOpen, {
  includeFiles: true,
});
const addSource = useAddKnowledgeSource();
const workspacesQuery = useWorkspaceList();

const workspaces = computed(() =>
  (workspacesQuery.data.value ?? []).filter((row) => !row.isArchived),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    browsePath.value = null;
    selectedFilePath.value = null;
    addSource.reset();
  },
  { immediate: true },
);

const listing = computed(() => listingQuery.data.value);
const selectedPath = computed(
  () => selectedFilePath.value ?? listing.value?.path ?? null,
);

function openFolder(path: string) {
  selectedFilePath.value = null;
  browsePath.value = path;
}

function pickFile(path: string) {
  selectedFilePath.value = selectedFilePath.value === path ? null : path;
}

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
    selectedPath.value !== null &&
    anchorWorkspaceId.value !== null &&
    !addSource.isPending.value,
);

const errorMessage = computed(() => {
  const error = addSource.error.value ?? listingQuery.error.value;
  return error ? formatSdkError(error) : null;
});

function add() {
  if (!canAdd.value || selectedPath.value === null) return;
  addSource.mutate(
    {
      anchorWorkspaceId: anchorWorkspaceId.value!,
      absolutePath: selectedPath.value,
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
    size="lg"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <div class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Folder or file</span>
        <div class="overflow-hidden rounded-sm border border-hair-strong bg-panel">
          <div class="flex items-center gap-2 border-b border-hair px-2 py-1.5">
            <button
              type="button"
              class="cursor-default rounded-sm border border-hair px-1.5 py-[3px] text-ink-2 transition hover:enabled:bg-row-hover hover:enabled:text-ink-1 disabled:opacity-40"
              :disabled="!listing?.parent"
              title="Up one folder"
              @click="listing?.parent && openFolder(listing.parent)"
            >
              <ArrowUp :size="13" />
            </button>
            <span
              class="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] font-medium text-ink-1"
              >{{ selectedPath ?? "…" }}</span
            >
          </div>
          <div
            v-if="listing?.drives?.length"
            class="flex flex-wrap gap-[5px] border-b border-hair px-2 py-1.5"
          >
            <button
              v-for="drive in listing.drives"
              :key="drive"
              type="button"
              class="inline-flex cursor-default items-center gap-1 rounded-full border border-hair px-2 py-0.5 font-mono text-[10.5px] font-medium text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
              @click="openFolder(drive)"
            >
              <HardDrive :size="11" />
              {{ drive }}
            </button>
          </div>
          <div class="grid max-h-[180px] gap-px overflow-y-auto p-1">
            <button
              v-for="entry in listing?.entries ?? []"
              :key="entry.path"
              type="button"
              class="flex cursor-default items-center gap-[7px] rounded-sm px-2 py-[5px] text-left text-xs text-ink-1 transition hover:bg-row-hover"
              @click="openFolder(entry.path)"
            >
              <Folder :size="13" class="shrink-0 text-file-folder" />
              {{ entry.name }}
            </button>
            <button
              v-for="file in listing?.files ?? []"
              :key="file.path"
              type="button"
              class="flex cursor-default items-center gap-[7px] rounded-sm px-2 py-[5px] text-left text-xs text-ink-1 transition"
              :class="
                selectedFilePath === file.path
                  ? 'bg-row-active'
                  : 'hover:bg-row-hover'
              "
              @click="pickFile(file.path)"
            >
              <FileText :size="13" class="shrink-0 text-ink-3" />
              {{ file.name }}
            </button>
            <p
              v-if="
                listing &&
                listing.entries.length === 0 &&
                (listing.files?.length ?? 0) === 0
              "
              class="m-0 px-2 py-1.5 text-[11.5px] text-ink-3"
            >
              Nothing inside — this folder itself becomes the source.
            </p>
          </div>
        </div>
        <span class="text-[11px] text-ink-3">
          Click a file to add just that file — otherwise the open folder is
          what Claude studies.
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
