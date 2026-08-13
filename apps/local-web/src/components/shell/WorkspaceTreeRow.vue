<script setup lang="ts">
import { PhCaretRight as CaretRight, PhCircleNotch as CircleNotch } from "@phosphor-icons/vue";
import { workspaceAccentVar, workspaceMonogram } from "@vynel/ui";
import type { WorkspacePresence } from "../../composables/workspaces/use-workspace-presence.js";

// One workspace row of the tree — used at the root and inside folders, so
// the row lives in exactly one home. Draggable: the tree owns the
// drag-and-drop state; the row only reports its lifecycle.
const props = defineProps<{
  workspace: { id: string; name: string };
  isActive: boolean;
  presence: WorkspacePresence;
  colorSlot?: number | null;
}>();

const emit = defineEmits<{
  select: [];
  drill: [];
  "drag-start": [];
  "drag-end": [];
}>();

function accent(): string {
  if (props.colorSlot !== undefined && props.colorSlot !== null)
    return `var(--ws-${props.colorSlot})`;
  return workspaceAccentVar(props.workspace.name);
}
</script>

<template>
  <div
    class="group flex items-center rounded-sm transition"
    :class="
      props.isActive
        ? 'bg-row-active text-ink-1'
        : 'text-ink-2 hover:bg-row-hover hover:text-ink-1'
    "
    draggable="true"
    @dragstart="emit('drag-start')"
    @dragend="emit('drag-end')"
  >
    <button
      type="button"
      :aria-label="`Open the ${props.workspace.name} menu`"
      class="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
      @click="emit('drill')"
    >
      <CaretRight :size="11" />
    </button>
    <button
      type="button"
      class="flex h-8 min-w-0 flex-1 cursor-default items-center gap-2 pr-2 text-left text-sm"
      :aria-current="props.isActive ? 'page' : undefined"
      @click="emit('select')"
      @dblclick="emit('drill')"
    >
      <span
        class="grid size-5 shrink-0 place-items-center rounded-[4px] text-[10px] font-semibold text-white"
        :style="{ background: accent() }"
      >
        <CircleNotch v-if="props.presence === 'working'" :size="12" class="animate-spin" />
        <template v-else>{{ workspaceMonogram(props.workspace.name) }}</template>
      </span>
      <span class="min-w-0 flex-1 truncate">{{ props.workspace.name }}</span>
      <span
        v-if="props.presence === 'attention'"
        :aria-label="`${props.workspace.name} is waiting on you`"
        class="size-2 shrink-0 animate-pulse rounded-full bg-needs-input"
      />
    </button>
  </div>
</template>
