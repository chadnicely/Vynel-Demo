<script setup lang="ts">
import { computed, ref } from "vue";
import { Brain, Plus } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useMemoryEntriesInScope } from "../../composables/memory/use-memory-entries-in-scope.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import AddMemoryDialog from "./AddMemoryDialog.vue";
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
  <div class="memory-section">
    <header class="section-header">
      <Brain :size="15" class="section-icon" />
      <div class="section-text">
        <p class="section-title">Memory</p>
        <p class="section-hint">What Claude remembers about you and your work</p>
      </div>
      <button
        v-if="entries.length > 0"
        type="button"
        class="add-button"
        @click="isAddOpen = true"
      >
        <Plus :size="13" />
        Add memory
      </button>
    </header>

    <div v-if="entries.length > 0" class="rows">
      <div v-for="entry in entries" :key="entry.id" class="row">
        <div class="row-main">
          <p class="row-title">
            {{ entry.title }}
            <span class="kind-chip">{{
              KIND_LABELS[entry.kind] ?? entry.kind
            }}</span>
            <span v-if="props.scope.kind === 'global'" class="scope-chip">{{
              scopeLabel(entry.workspaceId)
            }}</span>
          </p>
          <p class="row-sub">{{ entry.body }}</p>
        </div>
        <span class="row-time">{{ formatRelativeTime(entry.updatedAt) }}</span>
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
        <button type="button" class="invite-button" @click="isAddOpen = true">
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

<style scoped>
.memory-section {
  display: grid;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 2px 4px;
}

.section-icon {
  color: var(--ink-2);
  flex: none;
  margin-top: 2px;
}

.section-text {
  min-width: 0;
  flex: 1;
}

.section-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.section-hint {
  margin: 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.add-button,
.invite-button {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 11px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: transparent;
  color: var(--ink-2);
  font: 600 11.5px/1.6 var(--font-ui);
  cursor: default;
  flex: none;
  transition: border-color var(--t-fast) var(--ease-out);
}

.invite-button {
  border-color: var(--hair-strong);
  background: var(--bg-raised);
  padding: 5px 14px;
}

.add-button:hover,
.invite-button:hover {
  color: var(--ink-1);
  border-color: var(--hair-strong);
  background: var(--row-hover);
}

.add-button:focus-visible,
.invite-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.rows {
  display: grid;
  gap: 4px;
}

.row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
}

.row-main {
  min-width: 0;
  flex: 1;
}

.row-title {
  margin: 0;
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.row-sub {
  margin: 1px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.kind-chip {
  color: var(--ink-2);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--hair);
  border-radius: 99px;
  padding: 0 6px;
  background: var(--bg-panel);
}

.scope-chip {
  color: var(--ink-3);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  padding: 0 6px;
}

.row-time {
  color: var(--ink-3);
  font: 400 10.5px/1.6 var(--font-ui);
  flex: none;
}
</style>
