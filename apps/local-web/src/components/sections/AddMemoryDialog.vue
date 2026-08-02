<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import { useCreateMemoryEntry } from "../../composables/memory/use-create-memory-entry.js";
import { useImportMemoryFile } from "../../composables/memory/use-import-memory-file.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import FilePickerField from "./FilePickerField.vue";
import MemoryTagsField from "./MemoryTagsField.vue";
import type { SectionScope } from "./section-scope.js";

// Add a memory two ways: write it by hand under one of the real memory kinds,
// or import a single on-disk file (the server parses it into an entry).
// Either way it can be tagged — "context" makes it always-known. Memory lives
// IN a workspace today; global memory is the planned build (module-notes).
const props = defineProps<{
  open: boolean;
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  created: [];
}>();

type MemoryKind =
  "person" | "preference" | "business-fact" | "recurring-pattern" | "note";

const KINDS: { id: MemoryKind; label: string; section: string }[] = [
  { id: "note", label: "Note", section: "Notes" },
  { id: "preference", label: "Preference", section: "Preferences" },
  { id: "person", label: "Person", section: "People" },
  { id: "business-fact", label: "Business fact", section: "Business facts" },
  { id: "recurring-pattern", label: "Pattern", section: "Patterns" },
];

const mode = ref<"write" | "file">("write");
const kind = ref<MemoryKind>("note");
const title = ref("");
const body = ref("");
const workspaceChoice = ref<string>("");
const selectedFilePath = ref<string | null>(null);
const selectedTags = ref<string[]>([]);

const workspacesQuery = useWorkspaceList();
const workspaces = computed(() =>
  (workspacesQuery.data.value ?? []).filter((row) => !row.isArchived),
);

const createEntry = useCreateMemoryEntry();
const importFile = useImportMemoryFile();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    mode.value = "write";
    kind.value = "note";
    title.value = "";
    body.value = "";
    selectedFilePath.value = null;
    selectedTags.value = [];
    // Seed from the cache too — an already-loaded list never re-fires the
    // watcher below, which would leave the select blank.
    workspaceChoice.value =
      props.defaultScope.kind === "workspace"
        ? props.defaultScope.workspaceId
        : (workspaces.value[0]?.id ?? "");
    createEntry.reset();
    importFile.reset();
  },
  { immediate: true },
);

// Default the global surface to the first workspace once the list arrives.
watch(workspaces, (rows) => {
  if (workspaceChoice.value === "" && rows.length > 0) {
    workspaceChoice.value = rows[0]!.id;
  }
});

const canSubmit = computed(() => {
  if (workspaceChoice.value === "") return false;
  if (mode.value === "write") {
    return body.value.trim().length > 0 && !createEntry.isPending.value;
  }
  return selectedFilePath.value !== null && !importFile.isPending.value;
});

const isPending = computed(() =>
  mode.value === "write"
    ? createEntry.isPending.value
    : importFile.isPending.value,
);

const errorMessage = computed(() => {
  const error =
    mode.value === "write" ? createEntry.error.value : importFile.error.value;
  return error ? formatSdkError(error) : null;
});

function submit() {
  if (!canSubmit.value) return;
  if (mode.value === "file") {
    importFile.mutate(
      {
        workspaceId: workspaceChoice.value,
        absolutePath: selectedFilePath.value!,
        tags: selectedTags.value,
      },
      { onSuccess: () => emit("created") },
    );
    return;
  }
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
        ...(selectedTags.value.length > 0 ? { tags: selectedTags.value } : {}),
      },
    },
    { onSuccess: () => emit("created") },
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
    title="Add a memory"
    description="Something Claude should remember — it recalls memories in every conversation where they matter."
    size="md"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <div
        class="inline-flex self-start gap-0.5 rounded-sm border border-hair bg-panel p-0.5"
        role="group"
        aria-label="How to add it"
      >
        <button
          type="button"
          class="cursor-default rounded-sm px-3 py-1 text-[11.5px] font-semibold transition"
          :class="
            mode === 'write'
              ? 'bg-raised text-ink-1 shadow-[inset_0_0_0_1px_var(--hair-strong)]'
              : 'text-ink-2 hover:text-ink-1'
          "
          :aria-pressed="mode === 'write'"
          @click="mode = 'write'"
        >
          Write it
        </button>
        <button
          type="button"
          class="cursor-default rounded-sm px-3 py-1 text-[11.5px] font-semibold transition"
          :class="
            mode === 'file'
              ? 'bg-raised text-ink-1 shadow-[inset_0_0_0_1px_var(--hair-strong)]'
              : 'text-ink-2 hover:text-ink-1'
          "
          :aria-pressed="mode === 'file'"
          @click="mode = 'file'"
        >
          From a file
        </button>
      </div>

      <template v-if="mode === 'write'">
        <div class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2">Kind</span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="option in KINDS"
              :key="option.id"
              type="button"
              class="cursor-default rounded-full border px-3 py-1 text-[11.5px] font-medium transition"
              :class="
                kind === option.id
                  ? 'border-gold bg-gold-soft text-ink-1'
                  : 'border-hair bg-panel text-ink-2 hover:border-hair-strong hover:text-ink-1'
              "
              :aria-pressed="kind === option.id"
              @click="kind = option.id"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2">What to remember</span>
          <textarea
            v-model="body"
            rows="3"
            autofocus
            placeholder="e.g. Invoices are always due on the 15th; remind me two days before."
            class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          />
        </label>

        <label class="grid gap-1.5">
          <span class="text-[11.5px] font-semibold text-ink-2">
            Title
            <span class="text-[10px] font-medium uppercase tracking-wide text-ink-3">optional</span>
          </span>
          <input
            v-model="title"
            type="text"
            maxlength="120"
            placeholder="e.g. Invoice cadence"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
          />
        </label>
      </template>

      <div v-else class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">File</span>
        <FilePickerField v-model="selectedFilePath" />
        <span class="text-[11px] text-ink-3">
          Click a file to import it as a memory — folders just navigate.
        </span>
      </div>

      <MemoryTagsField
        v-model:selected="selectedTags"
        :workspace-id="workspaceChoice || null"
      />

      <!-- A workspace surface IS the scope, so it never asks. The Global menu
           has nothing to derive — memory is workspace-owned today (no global
           entries), so there the workspace has to be chosen. -->
      <label v-if="props.defaultScope.kind === 'global'" class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Workspace</span>
        <select
          v-model="workspaceChoice"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
        >
          <option
            v-for="workspace in workspaces"
            :key="workspace.id"
            :value="workspace.id"
          >
            {{ workspace.name }}
          </option>
        </select>
        <span class="text-[11px] text-ink-3">
          Memories live in a workspace today — global memory is on the
          roadmap.
        </span>
      </label>

      <p
        v-if="workspaces.length === 0 && !workspacesQuery.isPending.value"
        class="m-0 text-xs text-danger"
        role="alert"
      >
        Create a workspace first — memories live inside one.
      </p>
      <p v-else-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
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
        :disabled="!canSubmit"
        @click="submit"
      >
        {{
          mode === "write"
            ? isPending
              ? "Saving…"
              : "Save memory"
            : isPending
              ? "Importing…"
              : "Import file"
        }}
      </button>
    </template>
  </Modal>
</template>
