<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useCreateMemoryEntry } from "../../composables/memory/use-create-memory-entry.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { SectionScope } from "./section-scope.js";

// Add a memory by hand: what Claude should remember, filed under one of the
// real memory kinds. Memory lives IN a workspace today — the scope select
// offers workspaces only; global memory (and the context/reminder/rules
// tagging Chad described) is the planned memory build (module-notes/memory.md).
const props = defineProps<{
  open: boolean;
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  created: [];
}>();

type MemoryKind =
  | "person"
  | "preference"
  | "business-fact"
  | "recurring-pattern"
  | "note";

const KINDS: { id: MemoryKind; label: string; section: string }[] = [
  { id: "note", label: "Note", section: "Notes" },
  { id: "preference", label: "Preference", section: "Preferences" },
  { id: "person", label: "Person", section: "People" },
  { id: "business-fact", label: "Business fact", section: "Business facts" },
  { id: "recurring-pattern", label: "Pattern", section: "Patterns" },
];

const kind = ref<MemoryKind>("note");
const title = ref("");
const body = ref("");
const workspaceChoice = ref<string>("");

const workspacesQuery = useWorkspaceList();
const workspaces = computed(() =>
  (workspacesQuery.data.value ?? []).filter((row) => !row.isArchived),
);

const createEntry = useCreateMemoryEntry();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    kind.value = "note";
    title.value = "";
    body.value = "";
    // Seed from the cache too — an already-loaded list never re-fires the
    // watcher below, which would leave the select blank.
    workspaceChoice.value =
      props.defaultScope.kind === "workspace"
        ? props.defaultScope.workspaceId
        : (workspaces.value[0]?.id ?? "");
    createEntry.reset();
  },
  { immediate: true },
);

// Default the global surface to the first workspace once the list arrives.
watch(workspaces, (rows) => {
  if (workspaceChoice.value === "" && rows.length > 0) {
    workspaceChoice.value = rows[0]!.id;
  }
});

const canCreate = computed(
  () =>
    body.value.trim().length > 0 &&
    workspaceChoice.value !== "" &&
    !createEntry.isPending.value,
);

const errorMessage = computed(() =>
  createEntry.error.value ? formatSdkError(createEntry.error.value) : null,
);

function create() {
  if (!canCreate.value) return;
  const kindMeta = KINDS.find((row) => row.id === kind.value)!;
  const trimmedTitle = title.value.trim();
  createEntry.mutate(
    {
      workspaceId: workspaceChoice.value,
      body: {
        kind: kind.value,
        body: body.value.trim(),
        category: kind.value === "preference" ? "preferences" : "memory",
        section: kindMeta.section,
        ...(trimmedTitle.length > 0 ? { title: trimmedTitle } : {}),
      },
    },
    { onSuccess: () => emit("created") },
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
        aria-label="Add a memory"
      >
        <header class="dialog-header">
          <h2 class="dialog-title">Add a memory</h2>
          <p class="dialog-subtitle">
            Something Claude should remember — it recalls memories in every
            conversation where they matter.
          </p>
        </header>

        <div class="field">
          <span class="field-label">Kind</span>
          <div class="chips">
            <button
              v-for="option in KINDS"
              :key="option.id"
              type="button"
              class="chip"
              :class="{ 'is-selected': kind === option.id }"
              :aria-pressed="kind === option.id"
              @click="kind = option.id"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <label class="field">
          <span class="field-label">What to remember</span>
          <textarea
            v-model="body"
            rows="3"
            autofocus
            placeholder="e.g. Invoices are always due on the 15th; remind me two days before."
          />
        </label>

        <label class="field">
          <span class="field-label">
            Title <span class="optional-tag">optional</span>
          </span>
          <input
            v-model="title"
            type="text"
            maxlength="120"
            placeholder="e.g. Invoice cadence"
          />
        </label>

        <label class="field">
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
          <span class="field-hint">
            Memories live in a workspace today — global memory is on the
            roadmap.
          </span>
        </label>

        <p
          v-if="workspaces.length === 0 && !workspacesQuery.isPending.value"
          class="dialog-error"
          role="alert"
        >
          Create a workspace first — memories live inside one.
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
            :disabled="!canCreate"
            @click="create"
          >
            {{ createEntry.isPending.value ? "Saving…" : "Save memory" }}
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
  width: min(460px, calc(100vw - 48px));
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

.optional-tag {
  color: var(--ink-3);
  font: 500 10px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.05em;
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

.field textarea,
.field input,
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

.field textarea:focus-visible,
.field input:focus-visible,
.scope-select:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -1px;
}

.field-hint {
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
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
