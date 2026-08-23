<script setup lang="ts">
import { computed } from "vue";
import type {
  PhaseListItemResponse,
  PhaseStatus,
} from "@vynel/contracts/phases/phase-http";
import TaskStatusControl from "../tasks/TaskStatusControl.vue";
import RowActions from "./RowActions.vue";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

// One phase card (the PlanRow idiom). Phases share the tasks status
// vocabulary, so the status tile is the SAME control. The ordinal chip names
// the row's place in the build order — the list already arrives ordered.
const props = defineProps<{
  phase: PhaseListItemResponse;
  /** 1-based place in the build order (the section derives it from the
   *  list's order, so a reorder never shows stale numbers). */
  position: number;
}>();

const emit = defineEmits<{
  "change-status": [status: PhaseStatus];
  view: [];
  edit: [];
  delete: [];
}>();

const isDone = computed(() => props.phase.status === "done");

// A done row trades its detail for when it finished — the list reads as a log.
const subtext = computed(() => {
  if (isDone.value)
    return props.phase.completedAt
      ? `Done ${formatRelativeTime(props.phase.completedAt)}`
      : "Done";
  return props.phase.descriptionPreview;
});
</script>

<template>
  <div
    class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
    :class="{ 'opacity-70': isDone }"
  >
    <TaskStatusControl
      noun="phase"
      :status="props.phase.status"
      @change="emit('change-status', $event)"
    />
    <div class="row-main min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span
          class="phase-ordinal inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
          >{{ props.position }}</span
        >
        <p
          class="row-title m-0 truncate text-sm font-semibold"
          :class="isDone ? 'text-ink-3 line-through' : 'text-ink-1'"
        >
          {{ props.phase.title }}
        </p>
      </div>
      <p v-if="subtext" class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
        {{ subtext }}
      </p>
    </div>
    <RowActions
      :subject="props.phase.title"
      @view="emit('view')"
      @edit="emit('edit')"
      @delete="emit('delete')"
    />
  </div>
</template>
