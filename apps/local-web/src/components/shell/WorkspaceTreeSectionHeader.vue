<script setup lang="ts">
import {
  PhCaretRight as CaretRight,
  PhPlus as Plus,
  PhStackPlus as StackPlus,
} from "@phosphor-icons/vue";

// One activity section's heading — its label, the project count, the fold
// caret, and (on Active Projects only) the create buttons. Creating belongs
// to Active: a new project is a thing you are about to work on, never
// something born parked (Chad, 2026-08-24).
const props = defineProps<{
  label: string;
  /** PROJECTS in the section, folders flattened. */
  count: number;
  /** Active Projects wears the accent — the working things are the headline. */
  accent: boolean;
  addable: boolean;
  collapsed: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  "create-group": [];
  "create-workspace": [];
}>();
</script>

<template>
  <div class="tree-section-header flex items-start">
    <button
      type="button"
      :aria-expanded="!props.collapsed"
      class="tree-section-toggle flex min-w-0 flex-1 cursor-default items-center gap-1.5 pb-2 pl-[10px] pr-0 pt-4 text-left text-[10px] font-semibold uppercase tracking-[0.12em] transition"
      :class="props.accent ? 'text-gold hover:text-gold' : 'text-ink-3 hover:text-ink-2'"
      @click="emit('toggle')"
    >
      <CaretRight
        :size="11"
        class="shrink-0 transition-transform"
        :class="props.collapsed ? '' : 'rotate-90'"
      />
      <span class="flex-1 truncate">{{ props.label }}</span>
      <span
        class="shrink-0 tabular-nums"
        :class="props.accent ? 'text-gold/70' : 'text-ink-3'"
      >
        {{ props.count }}
      </span>
    </button>
    <template v-if="props.addable">
      <button
        type="button"
        aria-label="New group"
        title="New group"
        class="tree-new-group mt-4 grid shrink-0 cursor-default place-items-center rounded-sm p-0.5 text-gold transition hover:text-ink-1"
        @click="emit('create-group')"
      >
        <StackPlus :size="14" weight="bold" />
      </button>
      <button
        type="button"
        aria-label="New workspace"
        title="New workspace"
        class="tree-new-workspace mt-4 grid shrink-0 cursor-default place-items-center rounded-sm p-0.5 text-gold transition hover:text-ink-1"
        @click="emit('create-workspace')"
      >
        <Plus :size="13" weight="bold" />
      </button>
    </template>
  </div>
</template>
