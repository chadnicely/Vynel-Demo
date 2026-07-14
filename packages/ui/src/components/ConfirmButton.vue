<script setup lang="ts">
import { ref } from "vue";

// The "arm-then-confirm" destructive idiom as one component (it was hand-rolled
// in AccountDeviceRow, ChannelsSection, MarketplaceSection, NotebookSection).
// First click arms and swaps to the confirm label; second click confirms; blur
// or Escape disarms. Icon goes in the `icon` slot.
const props = withDefaults(
  defineProps<{
    label: string;
    confirmLabel?: string;
    danger?: boolean;
    busy?: boolean;
    disabled?: boolean;
  }>(),
  { confirmLabel: "Confirm", danger: false, busy: false, disabled: false },
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
    class="inline-flex cursor-default select-none items-center gap-1.5 rounded-sm border px-2.5 py-1 text-sm font-medium outline-none transition focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-50"
    :class="
      armed
        ? props.danger
          ? 'border-danger bg-danger/15 text-danger'
          : 'border-gold bg-gold-soft text-gold-bright'
        : props.danger
          ? 'border-hair text-ink-2 hover:border-danger hover:text-danger'
          : 'border-hair text-ink-2 hover:bg-row-hover hover:text-ink-1'
    "
    @click="onClick"
    @blur="disarm"
    @keydown.esc="disarm"
  >
    <slot name="icon" />
    <span>{{ props.busy ? "…" : armed ? props.confirmLabel : props.label }}</span>
  </button>
</template>
