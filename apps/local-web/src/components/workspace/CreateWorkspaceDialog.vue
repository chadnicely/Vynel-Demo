<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowUp, Folder, HardDrive } from "lucide-vue-next";
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
watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = "";
      browsePath.value = null;
      registerWorkspace.reset();
    }
  },
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

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    // Claim the key so outer overlays (the Watch panel's document listener)
    // don't also close on the same press.
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
        aria-label="New workspace"
      >
        <header class="dialog-header">
          <h2 class="dialog-title">New workspace</h2>
          <p class="dialog-subtitle">
            A room for one area of your life or work — its own files, memory,
            and skills.
          </p>
        </header>

        <label class="field">
          <span class="field-label">Name</span>
          <input
            v-model="name"
            type="text"
            maxlength="120"
            placeholder="e.g. Bookkeeping"
            autofocus
            @keydown.enter.prevent="create"
          />
        </label>

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
              <span class="current-path" :title="selectedPath ?? ''">
                {{ selectedPath ?? "Loading…" }}
              </span>
            </div>

            <div v-if="listing?.drives?.length" class="drives">
              <button
                v-for="drive in listing.drives"
                :key="drive"
                type="button"
                class="drive"
                :class="{ 'is-active': selectedPath?.startsWith(drive) }"
                @click="browsePath = drive"
              >
                <HardDrive :size="11" />
                {{ drive }}
              </button>
            </div>

            <div class="entries" :class="{ 'is-loading': listingQuery.isFetching.value }">
              <button
                v-for="entry in listing?.entries ?? []"
                :key="entry.path"
                type="button"
                class="entry"
                @click="browsePath = entry.path"
              >
                <Folder :size="13" class="entry-icon" />
                <span class="entry-name">{{ entry.name }}</span>
              </button>
              <p
                v-if="listing && listing.entries.length === 0"
                class="empty-note"
              >
                No subfolders — this folder itself becomes the workspace.
              </p>
            </div>
          </div>
          <span class="field-hint">
            The open folder is the one Claude uses. Step into the folder you
            want, then create.
          </span>
        </div>

        <p v-if="errorMessage" class="dialog-error" role="alert">
          {{ errorMessage }}
        </p>

        <footer class="dialog-actions">
          <button type="button" class="cancel" @click="emit('close')">
            Cancel
          </button>
          <button
            type="button"
            class="create"
            :disabled="!canCreate"
            @click="create"
          >
            {{
              registerWorkspace.isPending.value
                ? "Creating…"
                : "Create workspace"
            }}
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
  width: min(480px, 92vw);
  background: var(--bg-panel);
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-overlay);
  padding: 20px 22px 18px;
  display: grid;
  gap: 14px;
}

.dialog-header {
  display: grid;
  gap: 2px;
}

.dialog-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 15px/1.4 var(--font-ui);
}

.dialog-subtitle {
  margin: 0;
  color: var(--ink-3);
  font: 400 12px/1.55 var(--font-ui);
}

.field {
  display: grid;
  gap: 5px;
}

.field-label {
  color: var(--ink-2);
  font: 600 12px/1.5 var(--font-ui);
}

.field-hint {
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}

.field input {
  appearance: none;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
  color: var(--ink-1);
  padding: 8px 10px;
  font: 400 13px/1.5 var(--font-ui);
}

.field input:focus-visible {
  outline: none;
  border-color: var(--gold);
}

.picker {
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  overflow: hidden;
}

.picker-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--hair);
}

.up {
  appearance: none;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  display: grid;
  place-items: center;
  width: 24px;
  height: 22px;
}

.up:hover:not(:disabled) {
  background: var(--row-hover);
}

.up:disabled {
  opacity: 0.4;
}

.current-path {
  color: var(--ink-2);
  font: 500 11.5px/1.4 var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.drives {
  display: flex;
  gap: 4px;
  padding: 6px 10px 0;
}

.drive {
  appearance: none;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-3);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font: 500 10.5px/1.6 var(--font-ui);
}

.drive:hover {
  background: var(--row-hover);
  color: var(--ink-2);
}

.drive.is-active {
  border-color: var(--gold);
  color: var(--ink-1);
}

.entries {
  height: 168px;
  overflow-y: auto;
  padding: 6px;
  display: grid;
  gap: 1px;
  align-content: start;
  transition: opacity var(--t-fast) var(--ease-out);
}

.entries.is-loading {
  opacity: 0.55;
}

.entry {
  appearance: none;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--radius-s);
  text-align: left;
}

.entry:hover {
  background: var(--row-hover);
}

.entry-icon {
  color: var(--file-folder);
  flex: none;
}

.entry-name {
  color: var(--ink-1);
  font: 400 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-note {
  margin: 8px;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.dialog-error {
  margin: 0;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.cancel {
  appearance: none;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  padding: 6px 16px;
  font: 600 12.5px/1.6 var(--font-ui);
}

.cancel:hover {
  background: var(--row-hover);
}

.create {
  appearance: none;
  border: 0;
  border-radius: var(--radius-s);
  background: var(--gold);
  color: #14171c;
  padding: 6px 18px;
  font: 600 12.5px/1.6 var(--font-ui);
  transition: background var(--t-fast) var(--ease-out);
}

.create:hover:not(:disabled) {
  background: var(--gold-bright);
}

.create:disabled {
  opacity: 0.5;
}
</style>
