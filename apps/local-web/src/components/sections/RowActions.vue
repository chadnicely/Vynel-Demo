<script setup lang="ts">
import { PhEye as Eye, PhPencilSimple as Pencil, PhX as X } from "@phosphor-icons/vue";

// The one home for a list row's action cluster: View · Edit · Delete, in a
// FIXED-width slot so every row's text column ends at the same edge (tasks,
// plans, journal all wear it). Buttons reveal on row hover (`group` on the
// row) but the width is always reserved — rows never reflow.
const props = defineProps<{
  /** Names the row for the accessible labels, e.g. "Ship the newsletter". */
  subject: string;
}>();

const emit = defineEmits<{
  view: [];
  edit: [];
  delete: [];
}>();
</script>

<template>
  <div class="row-actions flex w-[84px] shrink-0 items-center justify-end gap-0.5">
    <button
      type="button"
      class="action-button cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
      :title="`View ${props.subject}`"
      :aria-label="`View ${props.subject}`"
      @click="emit('view')"
    >
      <Eye :size="14" />
    </button>
    <button
      type="button"
      class="action-button cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-ink-1 focus-visible:opacity-100 group-hover:opacity-100"
      :title="`Edit ${props.subject}`"
      :aria-label="`Edit ${props.subject}`"
      @click="emit('edit')"
    >
      <Pencil :size="14" />
    </button>
    <button
      type="button"
      class="action-button cursor-default rounded-md p-1 text-ink-3 opacity-0 transition hover:bg-row-hover hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      :title="`Delete ${props.subject}`"
      :aria-label="`Delete ${props.subject}`"
      @click="emit('delete')"
    >
      <X :size="14" />
    </button>
  </div>
</template>
