<script setup lang="ts">
import { computed } from "vue";
import { BadgeCheck } from "lucide-vue-next";
import { MarkdownText, Modal } from "@vynel/ui";
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

// Modal owns Esc / backdrop / focus-trap / scroll-lock; it reports close via
// update:open, which we forward to the parent as `close`.
function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal :open="props.open" size="lg" @update:open="onOpenChange">
    <template #title>
      <span class="flex flex-wrap items-center gap-2">
        {{ props.book?.title }}
        <span
          v-if="props.book?.verified"
          class="verified-chip inline-flex shrink-0 items-center gap-1 rounded-full border border-gold-soft bg-gold-soft px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-gold"
        >
          <BadgeCheck :size="11" />
          Verified
        </span>
      </span>
    </template>

    <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
      {{ errorMessage }}
    </p>
    <p v-else-if="bodyText === null" class="m-0 text-xs text-ink-3">Opening…</p>
    <div
      v-else
      class="book-body rounded-sm border border-hair bg-panel p-3 text-sm leading-[1.65] text-ink-1 break-words"
    >
      <MarkdownText :source="bodyText" />
    </div>
  </Modal>
</template>
