<script setup lang="ts">
import { NotebookPen } from "lucide-vue-next";
import { Modal } from "@vynel/ui";
import type { JournalEntryResponse } from "@vynel/contracts/journal/journal-http";
import { formatDayLabel } from "../../utils/format-day-label.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

// View one journal entry in full — the long-form read the truncating list
// rows can't give. Read-only by nature; edits go through the Edit dialog.
const props = defineProps<{
  open: boolean;
  entry: JournalEntryResponse | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal :open="props.open" size="lg" @update:open="onOpenChange">
    <template #title>
      <span class="flex items-center gap-2">
        <NotebookPen :size="18" class="shrink-0 text-ink-3" />
        {{ props.entry ? formatDayLabel(props.entry.entryDate) : "Journal entry" }}
      </span>
    </template>

    <div v-if="props.entry" class="flex flex-col gap-3 pb-3 pt-1">
      <p
        class="entry-content m-0 whitespace-pre-wrap rounded-lg border border-hair bg-panel p-3 text-sm leading-relaxed text-ink-1"
      >
        {{ props.entry.content }}
      </p>
      <p class="m-0 text-xs text-ink-3">
        <span
          class="source-chip mr-1.5 inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ props.entry.source === "assistant" ? "Claude" : "You" }}</span
        >
        {{ props.entry.entryDate }} · written
        {{ formatRelativeTime(props.entry.createdAt) }}
      </p>
    </div>
  </Modal>
</template>
