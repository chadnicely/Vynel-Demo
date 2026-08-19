<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import { useCreateMemoryEntry } from "../../composables/memory/use-create-memory-entry.js";
import { useImportMemoryFile } from "../../composables/memory/use-import-memory-file.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import FileSystemBrowser from "../filesystem/FileSystemBrowser.vue";
import type { FileSystemSelection } from "../filesystem/file-system-selection.js";
import MemoryTagsField from "./MemoryTagsField.vue";
import type { SectionScope } from "./section-scope.js";

// Add a memory two ways: write it by hand, or import a single on-disk file
// (the server parses it into an entry). Either way it's TAGS that organize it
// — the old five-way Kind picker was a second, competing taxonomy asked at the
// worst moment. `kind` stays Claude's own classification (it buckets the
// session-context bundle); a hand-written entry is simply a note.
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope. Global writes a
   *  USER-level memory (no workspace anchor); a room writes into that room. */
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  created: [];
}>();

const mode = ref<"write" | "file">("write");
const title = ref("");
const body = ref("");
const selectedFile = ref<FileSystemSelection | null>(null);
const selectedTags = ref<string[]>([]);

const createEntry = useCreateMemoryEntry();
const importFile = useImportMemoryFile();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    mode.value = "write";
    title.value = "";
    body.value = "";
    selectedFile.value = null;
    selectedTags.value = [];
    createEntry.reset();
    importFile.reset();
  },
  { immediate: true },
);

const canSubmit = computed(() => {
  if (mode.value === "write") {
    return body.value.trim().length > 0 && !createEntry.isPending.value;
  }
  return selectedFile.value?.kind === "file" && !importFile.isPending.value;
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
        scope: props.defaultScope,
        absolutePath: selectedFile.value!.path,
        tags: selectedTags.value,
      },
      { onSuccess: () => emit("created") },
    );
    return;
  }
  const trimmedTitle = title.value.trim();
  createEntry.mutate(
    {
      scope: props.defaultScope,
      body: {
        kind: "note",
        body: body.value.trim(),
        category: "memory",
        section: "Notes",
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
    :size="mode === 'file' ? 'xl' : 'md'"
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
        <FileSystemBrowser v-model="selectedFile" mode="file" :active="props.open" />
        <span class="text-[11px] text-ink-3">
          Click a file to import it as a memory. Double-click a folder to open it.
        </span>
      </div>

      <MemoryTagsField
        v-model:selected="selectedTags"
        :scope="props.defaultScope"
      />

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
