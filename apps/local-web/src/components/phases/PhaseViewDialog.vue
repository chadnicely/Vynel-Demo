<script setup lang="ts">
import { computed } from "vue";
import { Modal } from "@vynel/ui";
import type { PhaseListItemResponse } from "@vynel/contracts/phases/phase-http";
import { usePhase } from "../../composables/phases/use-phase.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Read one phase in full — the list carries only a bounded preview of the
// big-form description, so the view reads through the detail door.
const props = defineProps<{
  open: boolean;
  workspaceId: string;
  phase: PhaseListItemResponse | null;
  /** 1-based place in the build order, derived by the SECTION from its sorted
   *  list — the same home the row chips read. `orderIndex` is not it: the
   *  server never renumbers on delete, so raw indexes drift from what the
   *  list shows. Null = unknown (the phase left the list mid-view). */
  position: number | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const viewingPhaseId = computed(() =>
  props.open && props.phase !== null ? props.phase.id : null,
);
const detailQuery = usePhase(() => props.workspaceId, viewingPhaseId);

const errorMessage = computed(() =>
  detailQuery.isError.value ? formatSdkError(detailQuery.error.value) : null,
);

const STATUS_LABELS = {
  open: "Open",
  "in-progress": "In progress",
  done: "Done",
} as const;

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="props.phase?.title ?? 'Phase'"
    @update:open="onOpenChange"
  >
    <div v-if="props.phase" class="flex flex-col gap-3 pt-1">
      <div class="flex items-center gap-2">
        <span
          v-if="props.position !== null"
          class="inline-flex items-center rounded-full border border-hair-strong px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3"
          >Phase {{ props.position }}</span
        >
        <span
          class="inline-flex items-center rounded-full border border-hair-strong px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ STATUS_LABELS[props.phase.status] }}</span
        >
      </div>

      <p v-if="errorMessage" class="m-0 text-xs text-danger">
        {{ errorMessage }}
      </p>
      <p
        v-else-if="detailQuery.isPending.value"
        class="m-0 text-xs text-ink-3"
      >
        Loading…
      </p>
      <p
        v-else
        class="m-0 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-1"
      >
        {{ detailQuery.data.value?.description }}
      </p>
    </div>
  </Modal>
</template>
