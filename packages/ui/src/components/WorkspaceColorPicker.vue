<script setup lang="ts">
import { computed } from "vue";
import {
  WORKSPACE_ACCENT_SLOTS,
  workspaceSlotName,
} from "../lib/workspace-color.js";

// The STANDALONE color-pick row (a form control, plain buttons): Auto, the
// workspace accent palette, and a CUSTOM swatch — a native colour input
// dressed as one more circle, so any hex the user likes becomes the accent
// (Kafi, 2026-08-19). Its menu twin is WorkspaceColorSwatches — that one's
// swatches are reka menu items and only mount inside a DropdownMenu; this
// one lives on ordinary surfaces like the Customize card.
const props = withDefaults(
  defineProps<{
    selectedSlot: number | null;
    /** A hand-picked `#rrggbb`; null when the accent is Auto or a palette slot. */
    customColor?: string | null;
    label?: string;
  }>(),
  { customColor: null, label: "Color" },
);

const emit = defineEmits<{
  pick: [slot: number | null];
  pickCustom: [hex: string];
}>();

const paletteSlots = Array.from(
  { length: WORKSPACE_ACCENT_SLOTS },
  (_, index) => index + 1,
);

const isAuto = computed(() => props.selectedSlot === null && props.customColor === null);

function onCustomInput(event: Event) {
  emit("pickCustom", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <p class="m-0 text-xs text-ink-2">{{ props.label }}</p>
    <div class="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Automatic color"
        :aria-pressed="isAuto"
        class="grid size-5 cursor-default place-items-center rounded-full border border-dashed border-ink-3 text-2xs text-ink-3 outline-none transition hover:scale-110 hover:border-ink-1 hover:text-ink-1"
        :class="isAuto ? 'ring-2 ring-ink-1 ring-offset-1 ring-offset-panel' : ''"
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
      <!-- Custom: the swatch IS the colour input — clicking opens the
           system picker; a rainbow ring says "any colour" until one is chosen. -->
      <label
        class="custom-swatch relative grid size-5 cursor-default place-items-center overflow-hidden rounded-full outline-none transition hover:scale-110 focus-within:ring-2 focus-within:ring-ink-1 focus-within:ring-offset-1 focus-within:ring-offset-panel"
        :class="props.customColor !== null ? 'ring-2 ring-ink-1 ring-offset-1 ring-offset-panel' : ''"
        :style="{
          background:
            props.customColor ??
            'conic-gradient(#f87171, #fbbf24, #4ade80, #38bdf8, #a78bfa, #f472b6, #f87171)',
        }"
        title="Custom color"
      >
        <input
          type="color"
          aria-label="Custom color"
          class="absolute inset-0 size-full cursor-default opacity-0"
          :value="props.customColor ?? '#8b5cf6'"
          @input="onCustomInput"
        />
      </label>
    </div>
  </div>
</template>
