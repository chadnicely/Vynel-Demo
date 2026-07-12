<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useCreateNotebookDocument } from "../../composables/notebook/use-create-notebook-document.js";
import { useUpdateNotebookDocument } from "../../composables/notebook/use-update-notebook-document.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { SectionScope } from "./section-scope.js";

// Write (or edit) one of the user's OWN books — a markdown playbook Claude
// opens on demand. Scope is immutable after creation (the core op's rule:
// delete + recreate to move a book), so editing hides the scope picker.
const props = defineProps<{
  open: boolean;
  defaultScope: SectionScope;
  /** A book to edit; null/absent = write a new one. */
  editing?: {
    id: string;
    title: string;
    body: string;
  } | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const title = ref("");
const body = ref("");
const scopeChoice = ref<"global" | "workspace">("global");
const workspaceChoice = ref<string>("");

const workspacesQuery = useWorkspaceList();
const workspaces = computed(() =>
  (workspacesQuery.data.value ?? []).filter((row) => !row.isArchived),
);

const createBook = useCreateNotebookDocument();
const updateBook = useUpdateNotebookDocument();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    title.value = props.editing?.title ?? "";
    body.value = props.editing?.body ?? "";
    scopeChoice.value =
      props.defaultScope.kind === "workspace" ? "workspace" : "global";
    workspaceChoice.value =
      props.defaultScope.kind === "workspace"
        ? props.defaultScope.workspaceId
        : (workspaces.value[0]?.id ?? "");
    createBook.reset();
    updateBook.reset();
  },
  { immediate: true },
);

// Default the workspace select once the list arrives (global-surface open).
watch(workspaces, (rows) => {
  if (workspaceChoice.value === "" && rows.length > 0) {
    workspaceChoice.value = rows[0]!.id;
  }
});

const isPending = computed(
  () => createBook.isPending.value || updateBook.isPending.value,
);

const canSubmit = computed(() => {
  if (title.value.trim().length === 0 || body.value.trim().length === 0)
    return false;
  if (
    !props.editing &&
    scopeChoice.value === "workspace" &&
    workspaceChoice.value === ""
  )
    return false;
  return !isPending.value;
});

const errorMessage = computed(() => {
  const error = props.editing
    ? updateBook.error.value
    : createBook.error.value;
  return error ? formatSdkError(error) : null;
});

function submit() {
  if (!canSubmit.value) return;
  if (props.editing) {
    updateBook.mutate(
      {
        documentId: props.editing.id,
        body: { title: title.value.trim(), body: body.value },
      },
      { onSuccess: () => emit("saved") },
    );
    return;
  }
  createBook.mutate(
    {
      title: title.value.trim(),
      body: body.value,
      scope: scopeChoice.value,
      ...(scopeChoice.value === "workspace"
        ? { workspaceId: workspaceChoice.value }
        : {}),
    },
    { onSuccess: () => emit("saved") },
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
        :aria-label="props.editing ? 'Edit book' : 'Write a book'"
      >
        <header class="dialog-header">
          <h2 class="dialog-title">
            {{ props.editing ? "Edit book" : "Write a book" }}
          </h2>
          <p class="dialog-subtitle">
            A playbook Claude opens when a matching task starts — how you like
            things done, step by step.
          </p>
        </header>

        <label class="field">
          <span class="field-label">Title</span>
          <input
            v-model="title"
            type="text"
            maxlength="120"
            autofocus
            placeholder="e.g. How we publish the newsletter"
          />
        </label>

        <label class="field">
          <span class="field-label">Content</span>
          <textarea
            v-model="body"
            rows="10"
            placeholder="Markdown works — headings, lists, steps. Claude reads this when the task calls for it."
          />
        </label>

        <template v-if="!props.editing">
          <div class="field">
            <span class="field-label">Where it applies</span>
            <div class="chips" role="group" aria-label="Where it applies">
              <button
                type="button"
                class="chip"
                :class="{ 'is-selected': scopeChoice === 'global' }"
                :aria-pressed="scopeChoice === 'global'"
                @click="scopeChoice = 'global'"
              >
                Everywhere
              </button>
              <button
                type="button"
                class="chip"
                :class="{ 'is-selected': scopeChoice === 'workspace' }"
                :aria-pressed="scopeChoice === 'workspace'"
                @click="scopeChoice = 'workspace'"
              >
                One workspace
              </button>
            </div>
          </div>

          <label v-if="scopeChoice === 'workspace'" class="field">
            <span class="field-label">Workspace</span>
            <select v-model="workspaceChoice" class="scope-select">
              <option
                v-for="workspace in workspaces"
                :key="workspace.id"
                :value="workspace.id"
              >
                {{ workspace.name }}
              </option>
            </select>
          </label>
        </template>

        <p
          v-if="
            !props.editing &&
            scopeChoice === 'workspace' &&
            workspaces.length === 0 &&
            !workspacesQuery.isPending.value
          "
          class="dialog-error"
          role="alert"
        >
          Create a workspace first — or keep the book global.
        </p>
        <p v-else-if="errorMessage" class="dialog-error" role="alert">
          {{ errorMessage }}
        </p>

        <footer class="dialog-actions">
          <button type="button" class="ghost" @click="emit('close')">
            Cancel
          </button>
          <button
            type="button"
            class="primary"
            :disabled="!canSubmit"
            @click="submit"
          >
            {{ isPending ? "Saving…" : "Save book" }}
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
  width: min(560px, calc(100vw - 48px));
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

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  appearance: none;
  margin: 0;
  padding: 4px 12px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: var(--bg-panel);
  color: var(--ink-2);
  font: 500 11.5px/1.5 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.chip:hover {
  color: var(--ink-1);
  border-color: var(--hair-strong);
}

.chip.is-selected {
  color: var(--ink-1);
  border-color: var(--gold);
  background: var(--gold-soft);
}

.chip:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.field > textarea,
.field > input,
.scope-select {
  appearance: none;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 400 12.5px/1.55 var(--font-ui);
  resize: vertical;
}

.field > textarea:focus-visible,
.field > input:focus-visible,
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
