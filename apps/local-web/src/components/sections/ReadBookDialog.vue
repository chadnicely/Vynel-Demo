<script setup lang="ts">
import { MarkdownText, Modal } from "@vynel/ui";

// Read one of the user's own books. The documents list carries every body,
// so the book arrives in hand — no fetch. The body renders through the house
// MarkdownText (DOMPurify-sanitized — the same renderer chat uses; never raw
// `v-html`).
const props = defineProps<{
  open: boolean;
  book: {
    id: string;
    title: string;
    body: string;
  } | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

// Modal owns Esc / backdrop / focus-trap / scroll-lock; it reports close via
// update:open, which we forward to the parent as `close`.
function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal :open="props.open" size="lg" @update:open="onOpenChange">
    <template #title>{{ props.book?.title }}</template>

    <div
      v-if="props.book !== null"
      class="book-body rounded-sm border border-hair bg-panel p-3 text-sm leading-[1.65] text-ink-1 break-words"
    >
      <MarkdownText :source="props.book.body" />
    </div>
  </Modal>
</template>
