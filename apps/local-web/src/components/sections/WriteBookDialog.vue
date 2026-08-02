<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import { useCreateNotebookDocument } from "../../composables/notebook/use-create-notebook-document.js";
import { useUpdateNotebookDocument } from "../../composables/notebook/use-update-notebook-document.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { SectionScope } from "./section-scope.js";

// Write (or edit) one of the user's OWN books — a markdown playbook Claude
// opens on demand. Scope is immutable after creation (the core op's rule:
// delete + recreate to move a book).
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope, never a suggestion. */
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

const createBook = useCreateNotebookDocument();
const updateBook = useUpdateNotebookDocument();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    title.value = props.editing?.title ?? "";
    body.value = props.editing?.body ?? "";
    createBook.reset();
    updateBook.reset();
  },
  { immediate: true },
);

const isPending = computed(
  () => createBook.isPending.value || updateBook.isPending.value,
);

const canSubmit = computed(
  () =>
    title.value.trim().length > 0 &&
    body.value.trim().length > 0 &&
    !isPending.value,
);

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
    props.defaultScope.kind === "workspace"
      ? {
          title: title.value.trim(),
          body: body.value,
          scope: "workspace",
          workspaceId: props.defaultScope.workspaceId,
        }
      : { title: title.value.trim(), body: body.value, scope: "global" },
    { onSuccess: () => emit("saved") },
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
    :title="props.editing ? 'Edit book' : 'Write a book'"
    description="A playbook Claude opens when a matching task starts — how you like things done, step by step."
    size="lg"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Title</span>
        <input
          v-model="title"
          type="text"
          maxlength="120"
          autofocus
          placeholder="e.g. How we publish the newsletter"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Content</span>
        <textarea
          v-model="body"
          rows="10"
          placeholder="Markdown works — headings, lists, steps. Claude reads this when the task calls for it."
          class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

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
        {{ isPending ? "Saving…" : "Save book" }}
      </button>
    </template>
  </Modal>
</template>
