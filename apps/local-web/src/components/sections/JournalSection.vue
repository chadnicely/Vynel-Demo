<script setup lang="ts">
import { computed, ref } from "vue";
import { PhNotePencil as NotebookPen, PhPlus as Plus } from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import type { JournalEntryResponse } from "@vynel/contracts/journal/journal-http";
import { useJournalEntriesInScope } from "../../composables/journal/use-journal-entries-in-scope.js";
import { useCreateJournalEntry } from "../../composables/journal/use-create-journal-entry.js";
import { useDeleteJournalEntry } from "../../composables/journal/use-delete-journal-entry.js";
import JournalEntryViewDialog from "../journal/JournalEntryViewDialog.vue";
import EditJournalEntryDialog from "../journal/EditJournalEntryDialog.vue";
import {
  formatDayLabel,
  localDayKey,
} from "../../utils/format-day-label.js";
import SectionHeader from "./SectionHeader.vue";
import JournalEntryRow from "./JournalEntryRow.vue";
import type { SectionScope } from "./section-scope.js";
import { useConversationSidebarStore } from "../../stores/conversation-sidebar-store.js";

// The journal section, on either surface: the daily record Claude writes and
// reads. Entries group under day headers (newest first — the list read the
// API already returns); the composer appends inline with a date defaulting
// to today. View/Edit/Delete are the USER's doors — the agent's surface
// stays append-only.
const props = defineProps<{
  scope: SectionScope;
}>();

const entriesQuery = useJournalEntriesInScope(() => props.scope);
const createEntry = useCreateJournalEntry();
const deleteEntry = useDeleteJournalEntry();
// The entry's pointer chip opens the writing session's conversation in the
// sidebar — the same door the task panel's session chip uses.
const conversationSidebar = useConversationSidebarStore();

const entries = computed(() => entriesQuery.data.value ?? []);

// Day groups preserving the list's newest-day-first order.
const dayGroups = computed(() => {
  const groups: { day: string; entries: JournalEntryResponse[] }[] = [];
  for (const entry of entries.value) {
    const group = groups.at(-1);
    if (group && group.day === entry.entryDate) group.entries.push(entry);
    else groups.push({ day: entry.entryDate, entries: [entry] });
  }
  return groups;
});

const newEntryContent = ref("");
const newEntryDate = ref(localDayKey());

function addEntry() {
  const content = newEntryContent.value.trim();
  if (
    content.length === 0 ||
    newEntryDate.value.length === 0 ||
    createEntry.isPending.value
  )
    return;
  const entryDate = newEntryDate.value;
  createEntry.mutate(
    props.scope.kind === "workspace"
      ? {
          scope: "workspace",
          workspaceId: props.scope.workspaceId,
          entryDate,
          content,
        }
      : { scope: "global", entryDate, content },
    { onSuccess: () => (newEntryContent.value = "") },
  );
}

function removeEntry(entry: JournalEntryResponse) {
  deleteEntry.mutate({ entryId: entry.id });
}

// View/Edit open over the ROW the action came from; the list stays put.
const viewingEntry = ref<JournalEntryResponse | null>(null);
const editingEntry = ref<JournalEntryResponse | null>(null);
</script>

<template>
  <div class="journal-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="NotebookPen"
      title="Journal"
      subtitle="The daily record of what happened — Claude reads it to pick threads back up"
    />

    <form
      class="composer flex items-start gap-2 rounded-lg border border-hair bg-raised py-1.5 pl-3 pr-1.5 transition focus-within:border-hair-strong"
      @submit.prevent="addEntry"
    >
      <Plus :size="15" class="mt-1.5 shrink-0 text-ink-3" />
      <textarea
        v-model="newEntryContent"
        rows="2"
        placeholder="What happened today…"
        aria-label="New journal entry"
        class="min-w-0 flex-1 resize-none border-0 bg-transparent py-1 text-sm text-ink-1 outline-none placeholder:text-ink-3"
      />
      <input
        v-model="newEntryDate"
        type="date"
        aria-label="New journal entry date"
        class="mt-1 shrink-0 border-0 bg-transparent text-xs text-ink-2 outline-none"
      />
      <button
        type="submit"
        class="add-button mt-0.5 inline-flex shrink-0 cursor-default items-center rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition enabled:hover:border-hair-strong enabled:hover:bg-row-hover enabled:hover:text-ink-1 disabled:opacity-50"
        :disabled="
          newEntryContent.trim().length === 0 || newEntryDate.length === 0
        "
      >
        Add
      </button>
    </form>

    <div v-if="dayGroups.length > 0" class="groups flex flex-col gap-3">
      <section v-for="group in dayGroups" :key="group.day" class="day-group">
        <h3
          class="day-label m-0 mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3"
        >
          {{ formatDayLabel(group.day) }}
        </h3>
        <div class="rows flex flex-col gap-2">
          <JournalEntryRow
            v-for="entry in group.entries"
            :key="entry.id"
            :entry="entry"
            @view="viewingEntry = entry"
            @edit="editingEntry = entry"
            @delete="removeEntry(entry)"
            @open-session="
              (sessionId, title) =>
                conversationSidebar.openSession({ sessionId, title })
            "
          />
        </div>
      </section>
    </div>

    <EmptyState
      v-else
      title="No entries yet"
      hint="As work lands, Claude records what happened here — or write one above."
    >
      <template #icon>
        <NotebookPen :size="22" />
      </template>
    </EmptyState>

    <JournalEntryViewDialog
      :open="viewingEntry !== null"
      :entry="viewingEntry"
      @close="viewingEntry = null"
    />
    <EditJournalEntryDialog
      :open="editingEntry !== null"
      :entry="editingEntry"
      @close="editingEntry = null"
    />
  </div>
</template>
