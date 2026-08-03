<script setup lang="ts">
import { computed, ref } from "vue";
import { NotebookText, Pencil, Plus, X } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useNotebookDocuments } from "../../composables/notebook/use-notebook-documents.js";
import { useDeleteNotebookDocument } from "../../composables/notebook/use-delete-notebook-document.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import ReadBookDialog from "./ReadBookDialog.vue";
import WriteBookDialog from "./WriteBookDialog.vue";
import SectionHeader from "./SectionHeader.vue";
import type { SectionScope } from "./section-scope.js";

// The notebook, on either surface: the user's OWN books — theirs to write,
// edit, and delete. The VERIFIED shelf that ships with the product is
// Claude-internal tooling and never surfaces here: showing system playbooks
// would only overload a non-technical user with material that isn't theirs
// to manage.
const props = defineProps<{
  scope: SectionScope;
}>();

const documentsQuery = useNotebookDocuments();
const ownBooks = computed(() => {
  const documents = documentsQuery.data.value ?? [];
  const scope = props.scope;
  // Strict per scope (the channels convention): the shelf lists only the
  // surface's own books. Claude still READS global books from a workspace
  // session — the resolved view is the session's, not the menu's.
  if (scope.kind === "global")
    return documents.filter((document) => document.scope === "global");
  return documents.filter(
    (document) => document.workspaceId === scope.workspaceId,
  );
});

const { scopeLabel } = useScopeLabel();
const deleteBook = useDeleteNotebookDocument();

// Unlike a knowledge source (re-addable) a hand-written book body is gone
// forever once deleted — so, per the account section's DeviceRow idiom, the
// X arms first ("Sure?"), only a second explicit click fires the delete,
// and losing focus disarms.
const armedDeleteId = ref<string | null>(null);

function requestDelete(documentId: string) {
  if (armedDeleteId.value !== documentId) {
    armedDeleteId.value = documentId;
    return;
  }
  armedDeleteId.value = null;
  deleteBook.mutate({ documentId });
}

function disarmDelete(documentId: string) {
  if (armedDeleteId.value === documentId) armedDeleteId.value = null;
}

type OpenBook = {
  id: string;
  title: string;
  body: string;
};

const readingBook = ref<OpenBook | null>(null);
const isWriteOpen = ref(false);
const editingBook = ref<{ id: string; title: string; body: string } | null>(
  null,
);

function openOwn(document: { id: string; title: string; body: string }) {
  readingBook.value = {
    id: document.id,
    title: document.title,
    body: document.body,
  };
}

function startWriting() {
  editingBook.value = null;
  isWriteOpen.value = true;
}

function startEditing(document: { id: string; title: string; body: string }) {
  editingBook.value = {
    id: document.id,
    title: document.title,
    body: document.body,
  };
  isWriteOpen.value = true;
}

function onSaved() {
  isWriteOpen.value = false;
  editingBook.value = null;
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <SectionHeader
      :icon="NotebookText"
      title="Notebook"
      subtitle="Playbooks Claude opens when a task calls for them"
    >
      <template v-if="ownBooks.length > 0" #actions>
        <button
          type="button"
          class="inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair px-3 py-0.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="startWriting"
        >
          <Plus :size="13" />
          Write a book
        </button>
      </template>
    </SectionHeader>

    <div v-if="ownBooks.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="document in ownBooks"
        :key="document.id"
        class="row is-own group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <button
          type="button"
          class="row-open flex min-w-0 flex-1 cursor-default items-center gap-3 border-0 bg-transparent p-0 text-left"
          @click="openOwn(document)"
        >
          <span
            class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-ws-2/12 text-ws-2"
          >
            <NotebookText :size="17" />
          </span>
          <div class="row-main min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
                {{ document.title }}
              </p>
              <span
                v-if="props.scope.kind === 'global'"
                class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
                >{{ scopeLabel(document.workspaceId) }}</span
              >
            </div>
            <p class="row-sub m-0 mt-0.5 line-clamp-2 text-xs text-ink-3">
              {{ document.body }}
            </p>
          </div>
        </button>
        <button
          type="button"
          class="icon-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
          :title="`Edit ${document.title}`"
          :aria-label="`Edit ${document.title}`"
          @click="startEditing(document)"
        >
          <Pencil :size="13" />
        </button>
        <button
          type="button"
          :class="
            armedDeleteId === document.id
              ? 'row-action is-danger inline-flex shrink-0 cursor-default items-center rounded-full border border-danger/40 px-3 py-0.5 text-xs font-semibold text-danger transition hover:border-danger hover:bg-danger/10'
              : 'icon-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100'
          "
          :title="
            armedDeleteId === document.id
              ? `Confirm delete ${document.title}`
              : `Delete ${document.title}`
          "
          :aria-label="
            armedDeleteId === document.id
              ? `Confirm delete ${document.title}`
              : `Delete ${document.title}`
          "
          @click="requestDelete(document.id)"
          @blur="disarmDelete(document.id)"
        >
          <template v-if="armedDeleteId === document.id">Sure?</template>
          <X v-else :size="13" />
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      title="Write your first book"
      hint="Playbooks Claude reads when a task calls for them. Write down how you like things done, and Claude follows it."
    >
      <template #icon>
        <NotebookText :size="22" />
      </template>
      <template #action>
        <button
          type="button"
          class="invite-button inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="startWriting"
        >
          <Plus :size="13" />
          Write a book
        </button>
      </template>
    </EmptyState>

    <ReadBookDialog
      :open="readingBook !== null"
      :book="readingBook"
      @close="readingBook = null"
    />
    <WriteBookDialog
      :open="isWriteOpen"
      :default-scope="props.scope"
      :editing="editingBook"
      @close="onSaved"
      @saved="onSaved"
    />
  </div>
</template>
