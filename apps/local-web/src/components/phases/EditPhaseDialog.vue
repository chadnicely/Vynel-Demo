<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import type { PhaseListItemResponse } from "@vynel/contracts/phases/phase-http";
import { usePhase } from "../../composables/phases/use-phase.js";
import { useCreatePhase } from "../../composables/phases/use-create-phase.js";
import { useUpdatePhase } from "../../composables/phases/use-update-phase.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Create or edit one phase — one dialog, both doors (`phase: null` =
// create). A phase's description is big-form and the LIST carries only a
// preview, so an edit fetches the full text through the detail read before
// the field fills; the fill happens ONCE per open, so a background refetch
// never clobbers typing.
const props = defineProps<{
  open: boolean;
  workspaceId: string;
  phase: PhaseListItemResponse | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const isEditing = computed(() => props.phase !== null);
const title = ref("");
const description = ref("");
const hasLoadedDescription = ref(false);

const createPhase = useCreatePhase();
const updatePhase = useUpdatePhase();

const editingPhaseId = computed(() =>
  props.open && props.phase !== null ? props.phase.id : null,
);
const detailQuery = usePhase(() => props.workspaceId, editingPhaseId);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    title.value = props.phase?.title ?? "";
    description.value = "";
    hasLoadedDescription.value = props.phase === null;
    createPhase.reset();
    updatePhase.reset();
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
  () => createPhase.isPending.value || updatePhase.isPending.value,
);

const canSubmit = computed(
  () =>
    title.value.trim().length > 0 &&
    description.value.trim().length > 0 &&
    hasLoadedDescription.value &&
    !isPending.value,
);

const errorMessage = computed(() => {
  const error = createPhase.error.value ?? updatePhase.error.value;
  return error ? formatSdkError(error) : null;
});

function submit() {
  if (!canSubmit.value) return;
  const body = {
    title: title.value.trim(),
    description: description.value.trim(),
  };
  if (props.phase === null) {
    createPhase.mutate(
      { workspaceId: props.workspaceId, ...body },
      { onSuccess: () => emit("close") },
    );
    return;
  }
  updatePhase.mutate(
    { workspaceId: props.workspaceId, phaseId: props.phase.id, ...body },
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
    :title="isEditing ? 'Edit phase' : 'New phase'"
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
          placeholder="What this phase delivers"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Description</span>
        <textarea
          v-model="description"
          rows="6"
          :placeholder="hasLoadedDescription ? 'The write-up of the phase.' : 'Loading…'"
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
