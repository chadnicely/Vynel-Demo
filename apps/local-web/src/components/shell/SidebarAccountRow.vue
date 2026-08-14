<script setup lang="ts">
import { PhCaretUpDown as ChevronsUpDown } from "@phosphor-icons/vue";
import { workspaceMonogram } from "@vynel/ui";

// The pinned account foot both sidebar views share (section menu + workspace
// tree) — extracted so the row exists in exactly one home.
const props = defineProps<{ accountName: string }>();

const emit = defineEmits<{ "open-account": [] }>();
</script>

<template>
  <!-- The canvas's account foot: a small accent chip + quiet 12.5px name. -->
  <button
    type="button"
    class="flex w-full cursor-default items-center gap-2.5 border-t border-hair px-3 py-2 text-left transition hover:bg-row-hover"
    @click="emit('open-account')"
  >
    <span
      class="grid size-5 shrink-0 place-items-center rounded-[4px] bg-[var(--color-accent-700)] text-[9px] font-semibold text-[var(--color-accent-100)]"
    >
      {{ workspaceMonogram(props.accountName) }}
    </span>
    <span class="min-w-0 flex-1 truncate text-[12.5px] text-ink-1">{{ props.accountName }}</span>
    <ChevronsUpDown :size="13" class="shrink-0 text-ink-3" />
  </button>
</template>
