<script setup lang="ts">
import { computed, ref } from "vue";
import { PhBrain as Brain, PhPlus as Plus } from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import { useMemoryEntriesInScope } from "../../composables/memory/use-memory-entries-in-scope.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import AddMemoryDialog from "./AddMemoryDialog.vue";
import SectionHeader from "./SectionHeader.vue";
import type { SectionScope } from "./section-scope.js";

// What Claude remembers, on either surface: the global menu holds the user's
// OWN memories (anchored to no workspace); a workspace drawer shows that
// room's. Claude adds memories itself through its memory tools — this section
// lets the user read them and add their own by hand.
const props = defineProps<{
  scope: SectionScope;
}>();

// What the memory is MADE OF, not what it's about (tags carry meaning now) and
// not who wrote it — Claude's own entries and the onboarding seeds are both
// `user-manual`. `createdSource` already records it, so nothing new is stored.
function sourceLabel(createdSource: string): string {
  return createdSource === "file-import" ? "File" : "Text";
}

const entriesQuery = useMemoryEntriesInScope(props.scope);
const entries = computed(() =>
  (entriesQuery.data.value ?? []).filter((entry) => !entry.isArchived),
);

const isAddOpen = ref(false);

function onCreated() {
  isAddOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <SectionHeader
      :icon="Brain"
      title="Memory"
      subtitle="What Claude remembers about you and your work"
    >
      <template #actions>
        <button
          v-if="entries.length > 0"
          type="button"
          class="add-button inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair bg-transparent px-2.5 py-0.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="isAddOpen = true"
        >
          <Plus :size="13" />
          Add memory
        </button>
      </template>
    </SectionHeader>

    <div v-if="entries.length > 0" class="flex flex-col gap-2">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="row group flex items-start gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <span
          class="grid size-9 shrink-0 place-items-center rounded-md bg-ws-3/12 text-ws-3"
        >
          <Brain :size="17" />
        </span>
        <div class="min-w-0 flex-1">
          <p
            class="m-0 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink-1"
          >
            {{ entry.title }}
            <span
              class="source-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ sourceLabel(entry.createdSource) }}</span
            >
            <!-- "context" is the always-known marker; gold is the attention accent. -->
            <span
              v-for="tag in entry.tags"
              :key="tag"
              class="tag-chip inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium"
              :class="
                tag === 'context'
                  ? 'is-context border-gold text-ink-2'
                  : 'border-hair text-ink-3'
              "
            >
              <span
                v-if="tag === 'context'"
                class="context-dot size-1 shrink-0 rounded-full bg-gold"
                aria-hidden="true"
              />
              {{ tag }}
            </span>
          </p>
          <p class="m-0 mt-0.5 line-clamp-2 text-sm text-ink-1">
            {{ entry.body }}
          </p>
        </div>
        <span class="shrink-0 text-xs text-ink-3">{{
          formatRelativeTime(entry.updatedAt)
        }}</span>
      </div>
    </div>

    <EmptyState
      v-else
      title="Nothing remembered yet"
      hint="Claude files memories here as you work together — or add one yourself: a preference, a person, a fact it should keep."
    >
      <template #icon>
        <Brain :size="22" />
      </template>
      <template #action>
        <button
          type="button"
          class="invite-button inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-1 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="isAddOpen = true"
        >
          <Plus :size="13" />
          Add a memory
        </button>
      </template>
    </EmptyState>

    <AddMemoryDialog
      :open="isAddOpen"
      :default-scope="props.scope"
      @close="isAddOpen = false"
      @created="onCreated"
    />
  </div>
</template>

