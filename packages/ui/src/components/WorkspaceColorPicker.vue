<script setup lang="ts">
import {
  WORKSPACE_ACCENT_SLOTS,
  workspaceSlotName,
} from "../lib/workspace-color.js";

// The STANDALONE color-pick row (a form control, plain buttons): Auto plus
// the workspace accent palette. Its menu twin is WorkspaceColorSwatches —
// that one's swatches are reka menu items and only mount inside a
// DropdownMenu; this one lives on ordinary surfaces like the Customize card.
const props = withDefaults(
  defineProps<{ selectedSlot: number | null; label?: string }>(),
  { label: "Color" },
);

const emit = defineEmits<{ pick: [slot: number | null] }>();

const paletteSlots = Array.from(
  { length: WORKSPACE_ACCENT_SLOTS },
  (_, index) => index + 1,
);
</script>

<template>
  <div class="flex flex-col gap-1">
    <p class="m-0 text-xs text-ink-2">{{ props.label }}</p>
    <div class="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Automatic color"
        :aria-pressed="props.selectedSlot === null"
        class="grid size-5 cursor-default place-items-center rounded-full border border-dashed border-ink-3 text-2xs text-ink-3 outline-none transition hover:scale-110 hover:border-ink-1 hover:text-ink-1"
        :class="props.selectedSlot === null ? 'ring-2 ring-ink-1 ring-offset-1 ring-offset-panel' : ''"
        @click="emit('pick', null)"
      >
        A
      </button>
      <button
        v-for="slot in paletteSlots"
        :key="slot"
        type="button"
        :aria-label="workspaceSlotName(slot)"
        :aria-pressed="props.selectedSlot === slot"
        class="size-5 cursor-default rounded-full outline-none transition hover:scale-110"
        :class="props.selectedSlot === slot ? 'ring-2 ring-ink-1 ring-offset-1 ring-offset-panel' : ''"
        :style="{ background: `var(--ws-${slot})` }"
        @click="emit('pick', slot)"
      />
    </div>
  </div>
</template>
