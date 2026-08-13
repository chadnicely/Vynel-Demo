<script setup lang="ts">
// One edit-dialog field's frame: the label, the "Inherit default" checkbox,
// and the control (slot). Checked = the PUT sends null for this field and
// the tool keeps following Vynel's declared default.
const props = defineProps<{
  label: string;
  inherit: boolean;
}>();

const emit = defineEmits<{
  "update:inherit": [value: boolean];
}>();
</script>

<template>
  <div class="policy-field grid gap-1.5">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[11.5px] font-semibold text-ink-2">{{
        props.label
      }}</span>
      <label
        class="inherit-toggle inline-flex cursor-default items-center gap-1.5 text-[11px] text-ink-3"
      >
        <input
          type="checkbox"
          class="inherit-checkbox accent-[var(--gold)]"
          :checked="props.inherit"
          @change="
            emit(
              'update:inherit',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />
        Inherit default
      </label>
    </div>
    <slot />
  </div>
</template>
