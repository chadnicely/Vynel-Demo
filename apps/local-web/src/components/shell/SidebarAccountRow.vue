<script setup lang="ts">
import { PhCaretUpDown as ChevronsUpDown } from "@phosphor-icons/vue";
import { workspaceMonogram } from "@vynel/ui";

// The pinned account foot both sidebar views share (section menu + workspace
// tree) — extracted so the row exists in exactly one home.
const props = defineProps<{ accountName: string }>();

const emit = defineEmits<{ "open-account": [] }>();
</script>

<template>
  <button
    type="button"
    class="flex w-full cursor-default items-center gap-2.5 border-t border-hair px-3 py-2.5 text-left transition hover:bg-row-hover"
    @click="emit('open-account')"
  >
    <span class="grid size-6 shrink-0 place-items-center rounded-full bg-claude-soft text-2xs font-semibold text-claude">
      {{ workspaceMonogram(props.accountName) }}
    </span>
    <span class="min-w-0 flex-1 truncate text-sm text-ink-1">{{ props.accountName }}</span>
    <ChevronsUpDown :size="14" class="shrink-0 text-ink-3" />
  </button>
</template>
