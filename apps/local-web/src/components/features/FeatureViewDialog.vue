<script setup lang="ts">
import { computed } from "vue";
import { Modal } from "@vynel/ui";
import type { FeatureListItemResponse } from "@vynel/contracts/features/feature-http";
import type { PhaseListItemResponse } from "@vynel/contracts/phases/phase-http";
import { useFeature } from "../../composables/features/use-feature.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Read one feature in full — the list carries only a bounded preview of the
// big-form description, so the view reads through the detail door.
const props = defineProps<{
  open: boolean;
  workspaceId: string;
  feature: FeatureListItemResponse | null;
  /** The workspace's phases — names the feature's place in the build plan. */
  phases: PhaseListItemResponse[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const viewingFeatureId = computed(() =>
  props.open && props.feature !== null ? props.feature.id : null,
);
const detailQuery = useFeature(() => props.workspaceId, viewingFeatureId);

const errorMessage = computed(() =>
  detailQuery.isError.value ? formatSdkError(detailQuery.error.value) : null,
);

const phaseLabel = computed(() => {
  const linkedPhaseId = props.feature?.phaseId ?? null;
  if (linkedPhaseId === null) return "Not placed";
  return (
    props.phases.find((phase) => phase.id === linkedPhaseId)?.title ?? "A phase"
  );
});

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
    :title="props.feature?.title ?? 'Feature'"
    @update:open="onOpenChange"
  >
    <div v-if="props.feature" class="flex flex-col gap-3 pt-1">
      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center rounded-full border border-hair-strong px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ phaseLabel }}</span
        >
        <span
          class="inline-flex items-center rounded-full border border-hair-strong px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ STATUS_LABELS[props.feature.status] }}</span
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
