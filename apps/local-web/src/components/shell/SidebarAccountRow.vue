<script setup lang="ts">
import { PhCaretUpDown as ChevronsUpDown } from "@phosphor-icons/vue";
import { workspaceMonogram } from "@vynel/ui";

// The pinned account foot both sidebar views share (section menu + workspace
// tree) — extracted so the row exists in exactly one home.
const props = defineProps<{ accountName: string }>();

const emit = defineEmits<{ "open-account": [] }>();
</script>

<template>
  <!-- The canvas's account foot: 19px accent chip + a quiet 12.5px name, on
       the hairline, padded `11.2px 11.2px 4px` (top-heavy — the sidebar
       column's own bottom padding closes the gap below). -->
  <button
    type="button"
    class="flex w-full cursor-default items-center gap-[10px] border-t border-hair px-[11.2px] pb-1 pt-[11.2px] text-left transition hover:bg-row-hover"
    @click="emit('open-account')"
  >
    <span
      class="grid size-[19px] shrink-0 place-items-center rounded-[4px] bg-[var(--color-accent-700)] text-[9px] text-[var(--color-accent-100)]"
    >
      {{ workspaceMonogram(props.accountName) }}
    </span>
    <span class="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-neutral-400)]">{{
      props.accountName
    }}</span>
    <ChevronsUpDown :size="13" class="shrink-0 text-[var(--color-neutral-400)]" />
  </button>
</template>
