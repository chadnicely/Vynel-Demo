<script setup lang="ts">
import { ref } from "vue";

// The "arm-then-confirm" destructive idiom as one component (it was hand-rolled
// in AccountDeviceRow, ChannelsSection, MarketplaceSection, NotebookSection).
// First click arms and swaps to the confirm label; second click confirms; blur
// or Escape disarms. Icon goes in the `icon` slot.
//
// `compact` is the hover-row form (the tasks queue's trash, 2026-08-22): an
// icon alone in a round target with no border, that shows its confirm label
// only while armed — the same two clicks, a fraction of the footprint.
const props = withDefaults(
  defineProps<{
    label: string;
    confirmLabel?: string;
    danger?: boolean;
    busy?: boolean;
    disabled?: boolean;
    compact?: boolean;
  }>(),
  { confirmLabel: "Confirm", danger: false, busy: false, disabled: false, compact: false },
);

const emit = defineEmits<{
  confirm: [];
}>();

const armed = ref(false);

function onClick() {
  if (props.disabled || props.busy) return;
  if (!armed.value) {
    armed.value = true;
    return;
  }
  armed.value = false;
  emit("confirm");
}

function disarm() {
  armed.value = false;
}
</script>

<template>
  <button
    type="button"
    :disabled="props.disabled || props.busy"
    :aria-pressed="armed"
    :aria-label="props.compact ? (armed ? props.confirmLabel : props.label) : undefined"
    :title="props.compact && !armed ? props.label : undefined"
    class="inline-flex cursor-default select-none items-center outline-none transition focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50"
    :class="[
      props.compact
        ? 'gap-1 rounded-full px-1 py-px text-[10px] font-medium'
        : 'gap-1.5 rounded-sm border px-2.5 py-1 text-sm font-medium',
      armed
        ? props.danger
          ? props.compact
            ? 'bg-danger/15 text-danger'
            : 'border-danger bg-danger/15 text-danger'
          : props.compact
            ? 'bg-gold-soft text-gold-bright'
            : 'border-gold bg-gold-soft text-gold-bright'
        : props.danger
          ? props.compact
            ? 'text-ink-3 hover:bg-row-hover hover:text-danger'
            : 'border-hair text-ink-2 hover:border-danger hover:text-danger'
          : props.compact
            ? 'text-ink-3 hover:bg-row-hover hover:text-ink-1'
            : 'border-hair text-ink-2 hover:bg-row-hover hover:text-ink-1',
    ]"
    @click="onClick"
    @blur="disarm"
    @keydown.esc="disarm"
  >
    <slot name="icon" />
    <span v-if="!props.compact || armed || props.busy">
      {{ props.busy ? "…" : armed ? props.confirmLabel : props.label }}
    </span>
  </button>
</template>
