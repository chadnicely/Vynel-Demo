<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowUp, Folder, HardDrive } from "lucide-vue-next";
import { Modal } from "@vynel/ui";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import { useDirectoryListing } from "../../composables/workspaces/use-directory-listing.js";
import { useRegisterWorkspace } from "../../composables/workspaces/use-register-workspace.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// The "New workspace" dialog: name it, walk the real filesystem to an
// existing folder (the API's directory browser), register. The CURRENT
// listed directory is the selection — you navigate INTO the folder you want.
const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  created: [workspace: WorkspaceResponse];
}>();

const name = ref("");
// null = the API's default start (the user's home directory).
const browsePath = ref<string | null>(null);

const isOpen = computed(() => props.open);
const listingQuery = useDirectoryListing(browsePath, isOpen);
const registerWorkspace = useRegisterWorkspace();

// A fresh dialog per open — yesterday's half-typed name shouldn't linger.
// `immediate` covers a dialog mounted already-open (the same init hole the
// section dialogs had).
watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = "";
      browsePath.value = null;
      registerWorkspace.reset();
    }
  },
  { immediate: true },
);

const listing = computed(() => listingQuery.data.value);
const selectedPath = computed(() => listing.value?.path ?? null);
const canCreate = computed(
  () =>
    name.value.trim().length > 0 &&
    selectedPath.value !== null &&
    !registerWorkspace.isPending.value,
);

const errorMessage = computed(() => {
  const error = registerWorkspace.error.value ?? listingQuery.error.value;
  return error ? formatSdkError(error) : null;
});

function create() {
  if (!canCreate.value || selectedPath.value === null) return;
  registerWorkspace.mutate(
    { name: name.value.trim(), directory: selectedPath.value },
    {
      onSuccess: (workspace) =>
        emit("created", workspace as WorkspaceResponse),
    },
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
    title="New workspace"
    description="A room for one area of your life or work — its own files, memory, and skills."
    size="lg"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Name</span>
        <input
          v-model="name"
          type="text"
          maxlength="120"
          placeholder="e.g. Bookkeeping"
          autofocus
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          @keydown.enter.prevent="create"
        />
      </label>

      <div class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Folder</span>
        <div class="overflow-hidden rounded-md border border-hair bg-panel">
          <div class="flex items-center gap-2 border-b border-hair px-2.5 py-[7px]">
            <button
              type="button"
              class="grid h-[22px] w-6 cursor-default place-items-center rounded-sm border border-hair-strong text-ink-2 enabled:hover:bg-row-hover disabled:opacity-40"
              :disabled="!listing?.parent"
              title="Up one folder"
              @click="listing?.parent && (browsePath = listing.parent)"
            >
              <ArrowUp :size="13" />
            </button>
            <span
              class="overflow-hidden text-ellipsis whitespace-nowrap text-left font-mono text-[11.5px] font-medium text-ink-2 [direction:rtl]"
              :title="selectedPath ?? ''"
            >
              {{ selectedPath ?? "Loading…" }}
            </span>
          </div>

          <div v-if="listing?.drives?.length" class="flex gap-1 px-2.5 pt-1.5">
            <button
              v-for="drive in listing.drives"
              :key="drive"
              type="button"
              class="inline-flex cursor-default items-center gap-1 rounded-sm border px-2 py-0.5 text-[10.5px] font-medium"
              :class="
                selectedPath?.startsWith(drive)
                  ? 'border-gold text-ink-1'
                  : 'border-hair text-ink-3 hover:bg-row-hover hover:text-ink-2'
              "
              @click="browsePath = drive"
            >
              <HardDrive :size="11" />
              {{ drive }}
            </button>
          </div>

          <div
            class="grid h-[168px] content-start gap-px overflow-y-auto p-1.5 transition-opacity"
            :class="listingQuery.isFetching.value && 'opacity-55'"
          >
            <button
              v-for="entry in listing?.entries ?? []"
              :key="entry.path"
              type="button"
              class="entry flex cursor-default items-center gap-2 rounded-sm px-2 py-[5px] text-left hover:bg-row-hover"
              @click="browsePath = entry.path"
            >
              <Folder :size="13" class="shrink-0 text-file-folder" />
              <span class="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-ink-1">
                {{ entry.name }}
              </span>
            </button>
            <p
              v-if="listing && listing.entries.length === 0"
              class="m-2 text-[11.5px] text-ink-3"
            >
              No subfolders — this folder itself becomes the workspace.
            </p>
          </div>
        </div>
        <span class="text-[11px] text-ink-3">
          The open folder is the one Claude uses. Step into the folder you
          want, then create.
        </span>
      </div>

      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
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
        class="create cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canCreate"
        @click="create"
      >
        {{
          registerWorkspace.isPending.value ? "Creating…" : "Create workspace"
        }}
      </button>
    </template>
  </Modal>
</template>
