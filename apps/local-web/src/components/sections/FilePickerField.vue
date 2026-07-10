<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowUp, FileText, Folder, HardDrive } from "lucide-vue-next";
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
  <div class="picker">
    <div class="picker-bar">
      <button
        type="button"
        class="up"
        :disabled="!listing?.parent"
        title="Up one folder"
        @click="listing?.parent && openFolder(listing.parent)"
      >
        <ArrowUp :size="13" />
      </button>
      <span class="current-path">{{
        props.modelValue ?? listing?.path ?? "…"
      }}</span>
    </div>
    <div v-if="listing?.drives?.length" class="drives">
      <button
        v-for="drive in listing.drives"
        :key="drive"
        type="button"
        class="drive"
        @click="openFolder(drive)"
      >
        <HardDrive :size="11" />
        {{ drive }}
      </button>
    </div>
    <div class="entries">
      <button
        v-for="entry in listing?.entries ?? []"
        :key="entry.path"
        type="button"
        class="entry"
        @click="openFolder(entry.path)"
      >
        <Folder :size="13" class="entry-icon" />
        {{ entry.name }}
      </button>
      <button
        v-for="file in listing?.files ?? []"
        :key="file.path"
        type="button"
        class="entry"
        :class="{ 'is-selected': props.modelValue === file.path }"
        @click="pickFile(file.path)"
      >
        <FileText :size="13" class="entry-icon file" />
        {{ file.name }}
      </button>
      <p v-if="listingError" class="empty-note is-error">{{ listingError }}</p>
      <p
        v-else-if="
          listing &&
          listing.entries.length === 0 &&
          (listing.files?.length ?? 0) === 0
        "
        class="empty-note"
      >
        Nothing inside — go up and open a folder with files.
      </p>
    </div>
  </div>
</template>

<style scoped>
.picker {
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  overflow: hidden;
}

.picker-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--hair);
}

.up {
  appearance: none;
  border: 1px solid var(--hair);
  margin: 0;
  padding: 3px 6px;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  cursor: default;
}

.up:disabled {
  opacity: 0.4;
}

.up:hover:not(:disabled) {
  color: var(--ink-1);
  background: var(--row-hover);
}

.current-path {
  color: var(--ink-1);
  font: 500 11.5px/1.5 var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drives {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--hair);
}

.drive {
  appearance: none;
  border: 1px solid var(--hair);
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 99px;
  background: transparent;
  color: var(--ink-2);
  font: 500 10.5px/1.5 var(--font-mono);
  cursor: default;
}

.drive:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.entries {
  max-height: 180px;
  overflow-y: auto;
  padding: 4px;
  display: grid;
  gap: 1px;
}

.entry {
  appearance: none;
  border: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-1);
  font: 400 12px/1.5 var(--font-ui);
  text-align: left;
  cursor: default;
}

.entry:hover {
  background: var(--row-hover);
}

.entry.is-selected {
  background: var(--row-active);
  color: var(--ink-1);
}

.entry-icon {
  color: var(--file-folder);
  flex: none;
}

.entry-icon.file {
  color: var(--ink-3);
}

.empty-note {
  margin: 6px 8px;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.empty-note.is-error {
  color: var(--danger);
}
</style>
