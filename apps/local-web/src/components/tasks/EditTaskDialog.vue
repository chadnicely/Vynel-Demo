<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import type { TaskResponse } from "@vynel/contracts/tasks/task-http";
import { useUpdateTask } from "../../composables/tasks/use-update-task.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Edit one task (title / detail) — the user's door over tasksUser.update.
// Status moves stay on the row's cycle tile.
const props = defineProps<{
  open: boolean;
  task: TaskResponse | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const title = ref("");
const detail = ref("");

const updateTask = useUpdateTask();

watch(
  () => props.open,
  (open) => {
    if (!open || !props.task) return;
    title.value = props.task.title;
    detail.value = props.task.detail ?? "";
    updateTask.reset();
  },
  { immediate: true },
);

const canSubmit = computed(
  () => title.value.trim().length > 0 && !updateTask.isPending.value,
);

const errorMessage = computed(() =>
  updateTask.error.value ? formatSdkError(updateTask.error.value) : null,
);

function submit() {
  if (!canSubmit.value || !props.task) return;
  const trimmedDetail = detail.value.trim();
  updateTask.mutate(
    {
      taskId: props.task.id,
      title: title.value.trim(),
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
  <Modal :open="props.open" title="Edit task" @update:open="onOpenChange">
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
        <span class="text-[11.5px] font-semibold text-ink-2">Detail</span>
        <textarea
          v-model="detail"
          rows="4"
          placeholder="Longer context — optional."
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
