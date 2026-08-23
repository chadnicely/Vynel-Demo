<script setup lang="ts">
import { computed } from "vue";
import type {
  FeatureListItemResponse,
  FeatureStatus,
} from "@vynel/contracts/features/feature-http";
import TaskStatusControl from "../tasks/TaskStatusControl.vue";
import RowActions from "./RowActions.vue";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

// One feature card (the PlanRow idiom). Features share the tasks status
// vocabulary, so the status tile is the SAME control. The section groups
// rows under their phase, so the row itself carries no phase chip.
const props = defineProps<{
  feature: FeatureListItemResponse;
}>();

const emit = defineEmits<{
  "change-status": [status: FeatureStatus];
  view: [];
  edit: [];
  delete: [];
}>();

const isDone = computed(() => props.feature.status === "done");

// A done row trades its detail for when it finished — the list reads as a log.
const subtext = computed(() => {
  if (isDone.value)
    return props.feature.completedAt
      ? `Done ${formatRelativeTime(props.feature.completedAt)}`
      : "Done";
  return props.feature.descriptionPreview;
});
</script>

<template>
  <div
    class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
    :class="{ 'opacity-70': isDone }"
  >
    <TaskStatusControl
      noun="feature"
      :status="props.feature.status"
      @change="emit('change-status', $event)"
    />
    <div class="row-main min-w-0 flex-1">
      <p
        class="row-title m-0 truncate text-sm font-semibold"
        :class="isDone ? 'text-ink-3 line-through' : 'text-ink-1'"
      >
        {{ props.feature.title }}
      </p>
      <p v-if="subtext" class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
        {{ subtext }}
      </p>
    </div>
    <RowActions
      :subject="props.feature.title"
      @view="emit('view')"
      @edit="emit('edit')"
      @delete="emit('delete')"
    />
  </div>
</template>
