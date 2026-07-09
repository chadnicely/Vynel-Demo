<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowUp, Folder, HardDrive } from "lucide-vue-next";
import { useDirectoryListing } from "../../composables/workspaces/use-directory-listing.js";
import { useAddKnowledgeDirectory } from "../../composables/knowledge/use-add-knowledge-directory.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { SectionScope } from "./section-scope.js";

// Add a folder to the knowledge vault: walk the real filesystem to the
// directory Claude should study (the OPEN folder is the selection — the
// workspace-dialog convention), then choose where the knowledge lives.
// Single-FILE sources need backend support (the register route takes a
// directory) — a deliberate follow-up, not offered dishonestly here.
const props = defineProps<{
  open: boolean;
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  added: [];
}>();

// null = the API's default start (the user's home directory).
const browsePath = ref<string | null>(null);
// "global" or a workspaceId.
const scopeChoice = ref<string>("global");

const isOpen = computed(() => props.open);
const listingQuery = useDirectoryListing(browsePath, isOpen);
const addDirectory = useAddKnowledgeDirectory();
const workspacesQuery = useWorkspaceList();

const workspaces = computed(() =>
  (workspacesQuery.data.value ?? []).filter((row) => !row.isArchived),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    browsePath.value = null;
    scopeChoice.value =
      props.defaultScope.kind === "workspace"
        ? props.defaultScope.workspaceId
        : "global";
    addDirectory.reset();
  },
  { immediate: true },
);

const listing = computed(() => listingQuery.data.value);
const selectedPath = computed(() => listing.value?.path ?? null);

// Every knowledge route anchors on a workspace — a GLOBAL source anchors on
// the chosen (or first) workspace. No workspaces at all → nothing to anchor.
const anchorWorkspaceId = computed(() => {
  if (scopeChoice.value !== "global") return scopeChoice.value;
  if (props.defaultScope.kind === "workspace")
    return props.defaultScope.workspaceId;
  return workspaces.value[0]?.id ?? null;
});

const canAdd = computed(
  () =>
    selectedPath.value !== null &&
    anchorWorkspaceId.value !== null &&
    !addDirectory.isPending.value,
);

const errorMessage = computed(() => {
  const error = addDirectory.error.value ?? listingQuery.error.value;
  return error ? formatSdkError(error) : null;
});

function add() {
  if (!canAdd.value || selectedPath.value === null) return;
  addDirectory.mutate(
    {
      anchorWorkspaceId: anchorWorkspaceId.value!,
      absolutePath: selectedPath.value,
      scope: scopeChoice.value === "global" ? "global" : "workspace",
    },
    { onSuccess: () => emit("added") },
  );
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="dialog-backdrop"
      @pointerdown.self="emit('close')"
      @keydown="onKeydown"
    >
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add to knowledge"
      >
        <header class="dialog-header">
          <h2 class="dialog-title">Add a folder to knowledge</h2>
          <p class="dialog-subtitle">
            Claude studies every readable file inside — searchable in chat the
            moment it's indexed.
          </p>
        </header>

        <div class="field">
          <span class="field-label">Folder</span>
          <div class="picker">
            <div class="picker-bar">
              <button
                type="button"
                class="up"
                :disabled="!listing?.parent"
                title="Up one folder"
                @click="listing?.parent && (browsePath = listing.parent)"
              >
                <ArrowUp :size="13" />
              </button>
              <span class="current-path">{{ listing?.path ?? "…" }}</span>
            </div>
            <div v-if="listing?.drives?.length" class="drives">
              <button
                v-for="drive in listing.drives"
                :key="drive"
                type="button"
                class="drive"
                @click="browsePath = drive"
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
                @click="browsePath = entry.path"
              >
                <Folder :size="13" class="entry-icon" />
                {{ entry.name }}
              </button>
              <p v-if="listing && listing.entries.length === 0" class="empty-note">
                No subfolders — this folder itself becomes the source.
              </p>
            </div>
          </div>
          <span class="field-hint">
            The open folder is what Claude studies. Step into the folder you
            want, then add.
          </span>
        </div>

        <label class="field">
          <span class="field-label">Where it lives</span>
          <select v-model="scopeChoice" class="scope-select">
            <option value="global">Global — searchable everywhere</option>
            <option
              v-for="workspace in workspaces"
              :key="workspace.id"
              :value="workspace.id"
            >
              {{ workspace.name }} workspace only
            </option>
          </select>
        </label>

        <p v-if="anchorWorkspaceId === null" class="dialog-error" role="alert">
          Create a workspace first — knowledge indexing anchors on one.
        </p>
        <p v-else-if="errorMessage" class="dialog-error" role="alert">
          {{ errorMessage }}
        </p>

        <footer class="dialog-actions">
          <button type="button" class="ghost" @click="emit('close')">
            Cancel
          </button>
          <button type="button" class="primary" :disabled="!canAdd" @click="add">
            {{ addDirectory.isPending.value ? "Indexing…" : "Add to knowledge" }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: var(--bg-overlay);
}

.dialog {
  width: min(480px, calc(100vw - 48px));
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-l);
  background: var(--bg-raised);
  box-shadow: var(--shadow-overlay);
}

.dialog-header {
  display: grid;
  gap: 3px;
}

.dialog-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 15px/1.4 var(--font-ui);
}

.dialog-subtitle {
  margin: 0;
  color: var(--ink-2);
  font: 400 12px/1.5 var(--font-ui);
}

.field {
  display: grid;
  gap: 6px;
}

.field-label {
  color: var(--ink-2);
  font: 600 11.5px/1.5 var(--font-ui);
}

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

.entry-icon {
  color: var(--file-folder);
  flex: none;
}

.empty-note {
  margin: 6px 8px;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.field-hint {
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}

.scope-select {
  appearance: none;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 400 12.5px/1.5 var(--font-ui);
}

.scope-select:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -1px;
}

.dialog-error {
  margin: 0;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ghost,
.primary {
  appearance: none;
  border: 1px solid var(--hair-strong);
  margin: 0;
  padding: 6px 14px;
  border-radius: var(--radius-s);
  font: 600 12px/1.5 var(--font-ui);
  cursor: default;
}

.ghost {
  background: transparent;
  color: var(--ink-2);
}

.ghost:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.primary {
  border-color: transparent;
  background: var(--gold);
  color: #14171c;
}

.primary:hover:not(:disabled) {
  background: var(--gold-bright);
}

.primary:disabled {
  opacity: 0.55;
}

.ghost:focus-visible,
.primary:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
