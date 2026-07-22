<script setup lang="ts">
import { X } from "lucide-vue-next";
import type { JournalEntryResponse } from "@vynel/contracts/journal/journal-http";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

// One journal entry (the TaskRow idiom, prose-first): the content is the
// star, the chip says who wrote it, delete reveals on hover (the user's
// door — Claude can never remove history).
const props = defineProps<{
  entry: JournalEntryResponse;
}>();

const emit = defineEmits<{
  delete: [];
}>();
</script>

<template>
  <div
    class="row group flex items-start gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
  >
    <div class="row-main min-w-0 flex-1">
      <p class="row-content m-0 whitespace-pre-wrap text-sm text-ink-1">
        {{ props.entry.content }}
      </p>
      <div class="mt-1.5 flex items-center gap-2">
        <span
          class="source-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ props.entry.source === "assistant" ? "Claude" : "You" }}</span
        >
        <span class="row-time text-xs text-ink-3">{{
          formatRelativeTime(props.entry.createdAt)
        }}</span>
      </div>
    </div>
    <button
      type="button"
      class="delete-button shrink-0 cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      title="Delete this journal entry"
      aria-label="Delete this journal entry"
      @click="emit('delete')"
    >
      <X :size="14" />
    </button>
  </div>
</template>
