<script setup lang="ts">
import { computed } from "vue";
import { BadgeCheck } from "lucide-vue-next";
import { MarkdownText } from "@vynel/ui";
import { usePlaybook } from "../../composables/notebook/use-playbook.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import type { SectionScope } from "./section-scope.js";

// Read one book. An OWN book arrives with its body in hand (the documents
// list carries it); a VERIFIED book's body is fetched lazily by id. The body
// renders through the house MarkdownText (DOMPurify-sanitized — the same
// renderer chat uses; never raw `v-html`).
const props = defineProps<{
  open: boolean;
  scope: SectionScope;
  book: {
    id: string;
    title: string;
    verified: boolean;
    /** Null → fetch the body by id (verified books). */
    body: string | null;
  } | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const fetchedId = computed(() =>
  props.open && props.book !== null && props.book.body === null
    ? props.book.id
    : null,
);
const playbookQuery = usePlaybook(fetchedId, props.scope);

const bodyText = computed(
  () => props.book?.body ?? playbookQuery.data.value?.body ?? null,
);
const errorMessage = computed(() =>
  playbookQuery.isError.value
    ? formatSdkError(playbookQuery.error.value)
    : null,
);

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
      v-if="props.open && props.book !== null"
      class="dialog-backdrop"
      @pointerdown.self="emit('close')"
      @keydown="onKeydown"
    >
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="props.book.title"
      >
        <header class="dialog-header">
          <h2 class="dialog-title">
            {{ props.book.title }}
            <span v-if="props.book.verified" class="verified-chip">
              <BadgeCheck :size="11" />
              Verified
            </span>
          </h2>
        </header>

        <p v-if="errorMessage" class="dialog-error" role="alert">
          {{ errorMessage }}
        </p>
        <p v-else-if="bodyText === null" class="dialog-loading">Opening…</p>
        <div v-else class="book-body">
          <MarkdownText :source="bodyText" />
        </div>

        <footer class="dialog-actions">
          <button type="button" class="ghost" @click="emit('close')">
            Close
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
  width: min(640px, calc(100vw - 48px));
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  display: grid;
  gap: 12px;
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
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Gold marks team-shipped presence, matching the marketplace Official chip. */
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
  padding: 1px 7px;
  background: var(--gold-soft);
}

.book-body {
  padding: 12px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 400 12.5px/1.65 var(--font-ui);
  overflow-wrap: break-word;
}

.dialog-loading {
  margin: 0;
  color: var(--ink-3);
  font: 400 12px/1.5 var(--font-ui);
}

.dialog-error {
  margin: 0;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
}

.ghost {
  appearance: none;
  border: 1px solid var(--hair-strong);
  margin: 0;
  padding: 6px 14px;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  font: 600 12px/1.5 var(--font-ui);
  cursor: default;
}

.ghost:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.ghost:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
