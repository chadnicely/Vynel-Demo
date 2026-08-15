<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhArrowUp as ArrowUp,
  PhFileText as FileText,
  PhFolder as Folder,
  PhHardDrive as HardDrive,
} from "@phosphor-icons/vue";
import { useDirectoryListing } from "../../composables/workspaces/use-directory-listing.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Single-FILE picker: walk the real filesystem, folders navigate, a clicked
// file becomes the selection. Extracted so the memory dialog's file-import
// mode stays small; the knowledge dialog keeps its folder-or-file variant.
const props = defineProps<{
  modelValue: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [path: string | null];
}>();

// null = the API's default start (the user's home directory).
const browsePath = ref<string | null>(null);
// The picker only exists while its dialog is open, so the read is always on.
const listingQuery = useDirectoryListing(browsePath, ref(true), {
  includeFiles: true,
});

const listing = computed(() => listingQuery.data.value);
const listingError = computed(() =>
  listingQuery.error.value ? formatSdkError(listingQuery.error.value) : null,
);

function openFolder(path: string) {
  emit("update:modelValue", null);
  browsePath.value = path;
}

function pickFile(path: string) {
  emit("update:modelValue", props.modelValue === path ? null : path);
}
</script>

<template>
  <div class="overflow-hidden rounded-sm border border-hair-strong bg-panel">
    <div class="flex items-center gap-2 border-b border-hair px-2 py-1.5">
      <button
        type="button"
        class="cursor-default rounded-sm border border-hair px-1.5 py-[3px] text-ink-2 disabled:opacity-40 enabled:hover:bg-row-hover enabled:hover:text-ink-1"
        :disabled="!listing?.parent"
        title="Up one folder"
        @click="listing?.parent && openFolder(listing.parent)"
      >
        <ArrowUp :size="13" />
      </button>
      <span
        class="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] font-medium text-ink-1"
        >{{ props.modelValue ?? listing?.path ?? "…" }}</span
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
        class="inline-flex cursor-default items-center gap-1 rounded-full border border-hair px-2 py-0.5 font-mono text-[10.5px] font-medium text-ink-2 hover:bg-row-hover hover:text-ink-1"
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
        class="flex cursor-default items-center gap-[7px] rounded-sm px-2 py-[5px] text-left text-[12px] text-ink-1 hover:bg-row-hover"
        @click="openFolder(entry.path)"
      >
        <Folder :size="13" class="shrink-0 text-file-folder" />
        {{ entry.name }}
      </button>
      <button
        v-for="file in listing?.files ?? []"
        :key="file.path"
        type="button"
        class="flex cursor-default items-center gap-[7px] rounded-sm px-2 py-[5px] text-left text-[12px] text-ink-1"
        :class="props.modelValue === file.path ? 'bg-row-active' : 'hover:bg-row-hover'"
        @click="pickFile(file.path)"
      >
        <FileText :size="13" class="shrink-0 text-ink-3" />
        {{ file.name }}
      </button>
      <p v-if="listingError" class="mx-2 my-1.5 text-[11.5px] text-danger">{{ listingError }}</p>
      <p
        v-else-if="
          listing &&
          listing.entries.length === 0 &&
          (listing.files?.length ?? 0) === 0
        "
        class="mx-2 my-1.5 text-[11.5px] text-ink-3"
      >
        Nothing inside — go up and open a folder with files.
      </p>
    </div>
  </div>
</template>
