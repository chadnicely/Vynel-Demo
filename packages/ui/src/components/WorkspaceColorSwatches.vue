<script setup lang="ts">
import { DropdownMenuItem } from "reka-ui";
import {
  WORKSPACE_ACCENT_SLOTS,
  workspaceSlotName,
} from "../lib/workspace-color.js";
import { menuLabelClass } from "./menu-shared.js";

// A color-pick row for INSIDE a DropdownMenu (its `footer` slot): Auto plus
// the workspace accent palette. Each swatch is a REAL menu item — reka's
// modal menu swallows Tab and only roves registered items, so plain buttons
// here would be unreachable by keyboard. Select is prevented, so the menu
// stays open and picks live-preview on whatever the consumer paints. The
// standalone twin for ordinary surfaces is WorkspaceColorPicker.
const props = withDefaults(
  defineProps<{ selectedSlot: number | null; label?: string }>(),
  { label: "Color" },
);

const emit = defineEmits<{ pick: [slot: number | null] }>();

const paletteSlots = Array.from(
  { length: WORKSPACE_ACCENT_SLOTS },
  (_, index) => index + 1,
);

function onPick(event: Event, slot: number | null) {
  event.preventDefault();
  emit("pick", slot);
}
</script>

<template>
  <div class="pb-1">
    <p :class="menuLabelClass">{{ props.label }}</p>
    <div class="flex items-center gap-1.5 px-2.5 pb-1.5 pt-0.5">
      <DropdownMenuItem
        aria-label="Automatic color"
        text-value="Automatic"
        class="grid size-5 cursor-default place-items-center rounded-full border border-dashed border-ink-3 text-2xs text-ink-3 outline-none transition hover:border-ink-1 hover:text-ink-1 data-[highlighted]:border-ink-1 data-[highlighted]:text-ink-1 data-[highlighted]:scale-110"
        :class="props.selectedSlot === null ? 'ring-2 ring-ink-1 ring-offset-1 ring-offset-raised' : ''"
        @select="(event) => onPick(event, null)"
      >
        A
      </DropdownMenuItem>
      <DropdownMenuItem
        v-for="slot in paletteSlots"
        :key="slot"
        :aria-label="workspaceSlotName(slot)"
        :text-value="workspaceSlotName(slot)"
        class="size-5 cursor-default rounded-full outline-none transition hover:scale-110 data-[highlighted]:scale-110"
        :class="props.selectedSlot === slot ? 'ring-2 ring-ink-1 ring-offset-1 ring-offset-raised' : ''"
        :style="{ background: `var(--ws-${slot})` }"
        @select="(event) => onPick(event, slot)"
      />
    </div>
  </div>
</template>
