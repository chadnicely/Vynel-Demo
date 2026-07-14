<script setup lang="ts">
import { computed, ref } from "vue";
import { Brain, Plus } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useMemoryEntriesInScope } from "../../composables/memory/use-memory-entries-in-scope.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import AddMemoryDialog from "./AddMemoryDialog.vue";
import SectionHeader from "./SectionHeader.vue";
import type { SectionScope } from "./section-scope.js";

// What Claude remembers, on either surface: the global menu is the brain's
// overview across every workspace; a workspace drawer shows that room's.
// Claude adds memories itself through its memory tools — this section lets
// the user read them and add their own by hand.
const props = defineProps<{
  scope: SectionScope;
}>();

const KIND_LABELS: Record<string, string> = {
  person: "Person",
  preference: "Preference",
  "business-fact": "Business fact",
  "recurring-pattern": "Pattern",
  note: "Note",
};

const entriesQuery = useMemoryEntriesInScope(props.scope);
const entries = computed(() =>
  (entriesQuery.data.value ?? []).filter((entry) => !entry.isArchived),
);

const { scopeLabel } = useScopeLabel();

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

    <div v-if="entries.length > 0" class="flex flex-col gap-1">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="row flex items-start gap-2.5 rounded-sm border border-hair bg-raised px-2.5 py-2"
      >
        <div class="min-w-0 flex-1">
          <p
            class="m-0 flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink-1"
          >
            {{ entry.title }}
            <span
              class="kind-chip inline-flex items-center rounded-full border border-hair bg-panel px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-2"
              >{{ KIND_LABELS[entry.kind] ?? entry.kind }}</span
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
            <span
              v-if="props.scope.kind === 'global'"
              class="scope-chip inline-flex items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ scopeLabel(entry.workspaceId) }}</span
            >
          </p>
          <p class="mb-0 mt-px line-clamp-2 text-xs text-ink-3">
            {{ entry.body }}
          </p>
        </div>
        <span class="shrink-0 text-2xs text-ink-3">{{
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

