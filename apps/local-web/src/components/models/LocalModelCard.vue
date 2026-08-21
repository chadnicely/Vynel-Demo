<script setup lang="ts">
import { computed } from "vue";
import {
  PhDownloadSimple as DownloadSimple,
  PhTrash as Trash,
  PhXCircle as XCircle,
} from "@phosphor-icons/vue";
import type { LocalModelStatusResponse } from "@vynel/contracts/models/local-models-http";
import { describeLocalModelState } from "./local-model-state-copy.js";

// One local model as a card: what it is, whether it is on this computer, and
// the one action that fits its state (Download · Cancel · Remove). The default
// slot carries whatever the screen adds under it — the voice screen's "speak
// with this" pick, the speaker list. Data-blind: emits, never calls the API.
const props = defineProps<{
  model: LocalModelStatusResponse;
  /** An action is in flight for this model — the buttons wait. */
  busy?: boolean;
  /** The model can be removed from here (false where it is the only one of
   *  its kind and the feature would have nothing left). */
  removable?: boolean;
}>();

const emit = defineEmits<{
  download: [modelId: string];
  cancel: [modelId: string];
  remove: [modelId: string];
}>();

const copy = computed(() => describeLocalModelState(props.model));

const toneClass: Record<ReturnType<typeof describeLocalModelState>["tone"], string> = {
  ok: "border-gold text-gold",
  muted: "border-hair-strong text-ink-3",
  live: "border-[var(--color-accent)] text-[var(--color-accent)]",
  danger: "border-danger text-danger",
};
</script>

<template>
  <div class="model-card flex flex-col gap-2 rounded-lg border border-hair bg-raised p-3">
    <div class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 flex-col gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[13px] font-semibold text-ink-1">{{ props.model.label }}</span>
          <span
            class="state-badge rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide"
            :class="toneClass[copy.tone]"
            data-testid="model-state"
          >
            {{ copy.label }}
          </span>
        </div>
        <p class="m-0 text-xs text-ink-2">{{ props.model.description }}</p>
        <p class="state-detail m-0 text-[11px] text-ink-3" :class="{ 'text-danger': copy.tone === 'danger' }">
          {{ copy.detail }}
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <button
          v-if="props.model.state === 'missing' || props.model.state === 'failed'"
          type="button"
          class="download-button flex cursor-default items-center gap-1 rounded-sm bg-gold px-3 py-1 text-[11px] font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-60"
          :disabled="props.busy"
          @click="emit('download', props.model.id)"
        >
          <DownloadSimple :size="12" />
          {{ props.model.state === "failed" ? "Try again" : "Download" }}
        </button>
        <button
          v-else-if="props.model.state === 'downloading'"
          type="button"
          class="cancel-button flex cursor-default items-center gap-1 rounded-sm border border-hair-strong px-3 py-1 text-[11px] font-semibold text-ink-2 transition hover:text-ink-1 disabled:opacity-60"
          :disabled="props.busy"
          @click="emit('cancel', props.model.id)"
        >
          <XCircle :size="12" /> Cancel
        </button>
        <button
          v-else-if="props.removable"
          type="button"
          aria-label="Remove"
          title="Remove from this computer"
          class="remove-button grid cursor-default place-items-center rounded-sm border border-hair-strong p-1 text-ink-3 transition hover:text-danger disabled:opacity-60"
          :disabled="props.busy"
          @click="emit('remove', props.model.id)"
        >
          <Trash :size="12" />
        </button>
      </div>
    </div>

    <div
      v-if="props.model.state === 'downloading'"
      class="progress h-1 w-full overflow-hidden rounded-full bg-hair"
      role="progressbar"
      :aria-valuenow="copy.fraction === null ? undefined : Math.round(copy.fraction * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div
        class="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
        :class="{ 'animate-pulse': copy.fraction === null }"
        :style="{ width: `${Math.round((copy.fraction ?? 0.15) * 100)}%` }"
      />
    </div>

    <slot />
  </div>
</template>
