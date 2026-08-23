<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import type { FeatureListItemResponse } from "@vynel/contracts/features/feature-http";
import type { PhaseListItemResponse } from "@vynel/contracts/phases/phase-http";
import { useFeature } from "../../composables/features/use-feature.js";
import { useCreateFeature } from "../../composables/features/use-create-feature.js";
import { useUpdateFeature } from "../../composables/features/use-update-feature.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Create or edit one feature — one dialog, both doors (`feature: null` =
// create). Same big-form fetch-then-fill discipline as EditPhaseDialog, plus
// the phase picker: a feature is delivered by one build-plan phase (or none
// yet — "Not placed"), and editing to "Not placed" UNLINKS it (`phaseId:
// null` on the wire).
const props = defineProps<{
  open: boolean;
  workspaceId: string;
  feature: FeatureListItemResponse | null;
  /** The workspace's phases (the section already holds them) — the picker's
   *  options, in build order. */
  phases: PhaseListItemResponse[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const isEditing = computed(() => props.feature !== null);
const title = ref("");
const description = ref("");
// "" = Not placed — a <select> binds strings, so null travels as "".
const phaseId = ref("");
const hasLoadedDescription = ref(false);

const createFeature = useCreateFeature();
const updateFeature = useUpdateFeature();

const editingFeatureId = computed(() =>
  props.open && props.feature !== null ? props.feature.id : null,
);
const detailQuery = useFeature(() => props.workspaceId, editingFeatureId);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    title.value = props.feature?.title ?? "";
    description.value = "";
    phaseId.value = props.feature?.phaseId ?? "";
    hasLoadedDescription.value = props.feature === null;
    createFeature.reset();
    updateFeature.reset();
  },
  { immediate: true },
);

watch(
  () => detailQuery.data.value,
  (detail) => {
    if (!props.open || hasLoadedDescription.value || detail === undefined) return;
    description.value = detail.description;
    hasLoadedDescription.value = true;
  },
  { immediate: true },
);

const isPending = computed(
  () => createFeature.isPending.value || updateFeature.isPending.value,
);

const canSubmit = computed(
  () =>
    title.value.trim().length > 0 &&
    description.value.trim().length > 0 &&
    hasLoadedDescription.value &&
    !isPending.value,
);

const errorMessage = computed(() => {
  const error = createFeature.error.value ?? updateFeature.error.value;
  return error ? formatSdkError(error) : null;
});

function submit() {
  if (!canSubmit.value) return;
  const body = {
    title: title.value.trim(),
    description: description.value.trim(),
  };
  if (props.feature === null) {
    createFeature.mutate(
      {
        workspaceId: props.workspaceId,
        ...body,
        ...(phaseId.value !== "" ? { phaseId: phaseId.value } : {}),
      },
      { onSuccess: () => emit("close") },
    );
    return;
  }
  updateFeature.mutate(
    {
      workspaceId: props.workspaceId,
      featureId: props.feature.id,
      ...body,
      phaseId: phaseId.value !== "" ? phaseId.value : null,
    },
    { onSuccess: () => emit("close") },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="isEditing ? 'Edit feature' : 'New feature'"
    @update:open="onOpenChange"
  >
    <form class="flex flex-col gap-3.5 pt-1" @submit.prevent="submit">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Title</span>
        <input
          v-model="title"
          type="text"
          maxlength="200"
          autofocus
          placeholder="What this feature is"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Phase</span>
        <select
          v-model="phaseId"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
        >
          <option value="">Not placed</option>
          <option v-for="phase in props.phases" :key="phase.id" :value="phase.id">
            {{ phase.title }}
          </option>
        </select>
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Description</span>
        <textarea
          v-model="description"
          rows="6"
          :placeholder="hasLoadedDescription ? 'The write-up of the feature.' : 'Loading…'"
          :disabled="!hasLoadedDescription"
          class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3 disabled:opacity-60"
        />
      </label>

      <p v-if="errorMessage" class="m-0 text-xs text-danger">
        {{ errorMessage }}
      </p>
    </form>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-full border border-hair px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:text-ink-1"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="cursor-default rounded-full border border-gold bg-gold-soft px-3.5 py-1.5 text-xs font-semibold text-ink-1 transition enabled:hover:brightness-105 disabled:opacity-50"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ isEditing ? "Save" : "Create" }}
      </button>
    </template>
  </Modal>
</template>
