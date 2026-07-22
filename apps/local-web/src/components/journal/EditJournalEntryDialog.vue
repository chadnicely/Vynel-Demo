<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import type { JournalEntryResponse } from "@vynel/contracts/journal/journal-http";
import { useUpdateJournalEntry } from "../../composables/journal/use-update-journal-entry.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Edit one journal entry (content / day) — the USER's door over
// journalUser.update; the agent's surface stays append-only by design.
const props = defineProps<{
  open: boolean;
  entry: JournalEntryResponse | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const content = ref("");
const entryDate = ref("");

const updateEntry = useUpdateJournalEntry();

watch(
  () => props.open,
  (open) => {
    if (!open || !props.entry) return;
    content.value = props.entry.content;
    entryDate.value = props.entry.entryDate;
    updateEntry.reset();
  },
  { immediate: true },
);

const canSubmit = computed(
  () =>
    content.value.trim().length > 0 &&
    entryDate.value.length > 0 &&
    !updateEntry.isPending.value,
);

const errorMessage = computed(() =>
  updateEntry.error.value ? formatSdkError(updateEntry.error.value) : null,
);

function submit() {
  if (!canSubmit.value || !props.entry) return;
  updateEntry.mutate(
    {
      entryId: props.entry.id,
      content: content.value.trim(),
      entryDate: entryDate.value,
    },
    { onSuccess: () => emit("close") },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Edit journal entry"
    size="lg"
    @update:open="onOpenChange"
  >
    <form class="flex flex-col gap-3.5 pt-1" @submit.prevent="submit">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Entry</span>
        <textarea
          v-model="content"
          rows="8"
          autofocus
          class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Day</span>
        <input
          v-model="entryDate"
          type="date"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
        />
      </label>

      <p v-if="errorMessage" class="m-0 text-xs text-danger">
        {{ errorMessage }}
      </p>
    </form>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-full border border-hair px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:text-ink-1"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="cursor-default rounded-full border border-gold bg-gold-soft px-3.5 py-1.5 text-xs font-semibold text-ink-1 transition enabled:hover:brightness-105 disabled:opacity-50"
        :disabled="!canSubmit"
        @click="submit"
      >
        Save
      </button>
    </template>
  </Modal>
</template>
