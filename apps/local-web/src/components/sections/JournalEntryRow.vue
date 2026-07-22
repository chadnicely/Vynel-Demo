<script setup lang="ts">
import type { JournalEntryResponse } from "@vynel/contracts/journal/journal-http";
import RowActions from "./RowActions.vue";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

// One journal entry (the TaskRow idiom, prose-first): the content is the
// star, the chip says who wrote it, the fixed-width action cluster
// (View · Edit · Delete) reveals on hover — all three are the USER's doors;
// Claude can never rewrite or remove history.
const props = defineProps<{
  entry: JournalEntryResponse;
}>();

const emit = defineEmits<{
  view: [];
  edit: [];
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
    <!-- The day in the label keeps sibling rows' accessible names distinct. -->
    <RowActions
      :subject="`this ${props.entry.entryDate} journal entry`"
      @view="emit('view')"
      @edit="emit('edit')"
      @delete="emit('delete')"
    />
  </div>
</template>
