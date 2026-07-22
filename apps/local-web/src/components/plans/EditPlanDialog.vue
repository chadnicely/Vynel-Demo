<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import type { PlanResponse } from "@vynel/contracts/plans/plan-http";
import { useUpdatePlan } from "../../composables/plans/use-update-plan.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Edit one plan (title / date / detail) — the user's door over
// plansUser.update. Status moves stay on the row's cycle tile.
const props = defineProps<{
  open: boolean;
  plan: PlanResponse | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const title = ref("");
const planDate = ref("");
const detail = ref("");

const updatePlan = useUpdatePlan();

watch(
  () => props.open,
  (open) => {
    if (!open || !props.plan) return;
    title.value = props.plan.title;
    planDate.value = props.plan.planDate;
    detail.value = props.plan.detail ?? "";
    updatePlan.reset();
  },
  { immediate: true },
);

const canSubmit = computed(
  () =>
    title.value.trim().length > 0 &&
    planDate.value.length > 0 &&
    !updatePlan.isPending.value,
);

const errorMessage = computed(() =>
  updatePlan.error.value ? formatSdkError(updatePlan.error.value) : null,
);

function submit() {
  if (!canSubmit.value || !props.plan) return;
  const trimmedDetail = detail.value.trim();
  updatePlan.mutate(
    {
      planId: props.plan.id,
      title: title.value.trim(),
      planDate: planDate.value,
      detail: trimmedDetail.length > 0 ? trimmedDetail : null,
    },
    { onSuccess: () => emit("close") },
  );
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal :open="props.open" title="Edit plan" @update:open="onOpenChange">
    <form class="flex flex-col gap-3.5 pt-1" @submit.prevent="submit">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Title</span>
        <input
          v-model="title"
          type="text"
          maxlength="200"
          autofocus
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Day</span>
        <input
          v-model="planDate"
          type="date"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">Details</span>
        <textarea
          v-model="detail"
          rows="4"
          placeholder="The specifics of the day — optional."
          class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
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
        Save
      </button>
    </template>
  </Modal>
</template>
