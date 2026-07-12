<script setup lang="ts">
import { computed, ref } from "vue";
import { BadgeCheck, NotebookText, Pencil, Plus, X } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { usePlaybookShelf } from "../../composables/notebook/use-playbook-shelf.js";
import { useNotebookDocuments } from "../../composables/notebook/use-notebook-documents.js";
import { useDeleteNotebookDocument } from "../../composables/notebook/use-delete-notebook-document.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import ReadBookDialog from "./ReadBookDialog.vue";
import WriteBookDialog from "./WriteBookDialog.vue";
import type { SectionScope } from "./section-scope.js";

// The notebook, on either surface: the playbook shelf Claude opens when a
// task calls for it. VERIFIED books ship with the product and are read-only
// everywhere; the user's OWN books are theirs to write, edit, and delete.
const props = defineProps<{
  scope: SectionScope;
}>();

const shelfQuery = usePlaybookShelf(props.scope);
const verifiedBooks = computed(() =>
  (shelfQuery.data.value ?? []).filter((book) => book.verified),
);

const documentsQuery = useNotebookDocuments();
const ownBooks = computed(() => {
  const documents = documentsQuery.data.value ?? [];
  const scope = props.scope;
  if (scope.kind === "global") return documents;
  // A workspace surface shows what Claude sees from that workspace:
  // global books plus that workspace's own.
  return documents.filter(
    (document) =>
      document.scope === "global" ||
      document.workspaceId === scope.workspaceId,
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
  verified: boolean;
  body: string | null;
};

const readingBook = ref<OpenBook | null>(null);
const isWriteOpen = ref(false);
const editingBook = ref<{ id: string; title: string; body: string } | null>(
  null,
);

function openVerified(book: { id: string; title: string }) {
  readingBook.value = { ...book, verified: true, body: null };
}

function openOwn(document: { id: string; title: string; body: string }) {
  readingBook.value = {
    id: document.id,
    title: document.title,
    verified: false,
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
  <div class="notebook-section">
    <header class="section-header">
      <NotebookText :size="15" class="section-icon" />
      <div class="section-text">
        <p class="section-title">Notebook</p>
        <p class="section-hint">
          Playbooks Claude opens when a task calls for them
        </p>
      </div>
      <button
        v-if="ownBooks.length > 0"
        type="button"
        class="add-button"
        @click="startWriting"
      >
        <Plus :size="13" />
        Write a book
      </button>
    </header>

    <div v-if="verifiedBooks.length > 0" class="rows">
      <button
        v-for="book in verifiedBooks"
        :key="book.id"
        type="button"
        class="row is-verified"
        @click="openVerified(book)"
      >
        <div class="row-main">
          <p class="row-title">
            {{ book.title }}
            <span class="verified-chip">
              <BadgeCheck :size="11" />
              Verified
            </span>
          </p>
          <p class="row-sub">{{ book.oneLiner }}</p>
        </div>
      </button>
    </div>

    <div v-if="ownBooks.length > 0" class="rows">
      <div v-for="document in ownBooks" :key="document.id" class="row is-own">
        <button type="button" class="row-open" @click="openOwn(document)">
          <div class="row-main">
            <p class="row-title">
              {{ document.title }}
              <span v-if="props.scope.kind === 'global'" class="scope-chip">{{
                scopeLabel(document.workspaceId)
              }}</span>
            </p>
            <p class="row-sub">{{ document.body }}</p>
          </div>
        </button>
        <button
          type="button"
          class="icon-button"
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
              ? 'row-action is-danger'
              : 'icon-button'
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
      hint="Curated playbooks Claude reads when a task calls for them — plus your own. Write down how you like things done, and Claude follows it."
    >
      <template #icon>
        <NotebookText :size="22" />
      </template>
      <template #action>
        <button type="button" class="invite-button" @click="startWriting">
          <Plus :size="13" />
          Write a book
        </button>
      </template>
    </EmptyState>

    <ReadBookDialog
      :open="readingBook !== null"
      :book="readingBook"
      :scope="props.scope"
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

<style scoped>
.notebook-section {
  display: grid;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 2px 4px;
}

.section-icon {
  color: var(--ink-2);
  flex: none;
  margin-top: 2px;
}

.section-text {
  min-width: 0;
  flex: 1;
}

.section-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.section-hint {
  margin: 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.add-button,
.invite-button {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 11px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: transparent;
  color: var(--ink-2);
  font: 600 11.5px/1.6 var(--font-ui);
  cursor: default;
  flex: none;
  transition: border-color var(--t-fast) var(--ease-out);
}

.invite-button {
  border-color: var(--hair-strong);
  background: var(--bg-raised);
  padding: 5px 14px;
}

.add-button:hover,
.invite-button:hover {
  color: var(--ink-1);
  border-color: var(--hair-strong);
  background: var(--row-hover);
}

.add-button:focus-visible,
.invite-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.rows {
  display: grid;
  gap: 4px;
}

.row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
  text-align: left;
}

/* A verified row is one big open-to-read button. */
button.row {
  appearance: none;
  margin: 0;
  width: 100%;
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

button.row:hover,
.row.is-own:hover {
  border-color: var(--hair-strong);
}

button.row:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

/* An own row's open-to-read surface is a real button (keyboard-openable,
   like the verified rows) with the edit/delete controls adjacent, not
   nested — a button may not contain buttons. */
.row-open {
  appearance: none;
  margin: 0;
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  min-width: 0;
  flex: 1;
  cursor: default;
}

.row-open:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.row-main {
  min-width: 0;
  flex: 1;
}

.row-title {
  margin: 0;
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.row-sub {
  margin: 1px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Gold marks team-shipped presence (the marketplace Official chip idiom). */
.verified-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--gold);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--gold-soft);
  border-radius: 99px;
  padding: 0 6px;
  background: var(--gold-soft);
}

.scope-chip {
  color: var(--ink-3);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  padding: 0 6px;
}

.icon-button {
  appearance: none;
  margin: 0;
  border: 0;
  padding: 3px;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-3);
  cursor: default;
  flex: none;
}

.icon-button:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.icon-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

/* The armed "Sure?" step borrows the account section's row-action idiom. */
.row-action {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  padding: 3px 11px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: transparent;
  font: 600 11.5px/1.6 var(--font-ui);
  cursor: default;
  flex: none;
  transition: border-color var(--t-fast) var(--ease-out);
}

.row-action.is-danger {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
}

.row-action.is-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.row-action:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
