<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal, SegmentedTabs } from "@vynel/ui";
import { useCreateSchedule } from "../../composables/schedules/use-create-schedule.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import {
  ONE_TIME_PRESETS,
  buildCronExpression,
  fireAtFromPreset,
  type OneTimePreset,
  type RepeatFrequency,
} from "../../utils/schedule-cadence.js";
import type { SectionScope } from "./section-scope.js";

// Create a schedule: what Claude should do, and when — once (quick presets or
// a picked instant) or on a repeating cadence (daily / weekly / monthly at a
// time).
const props = defineProps<{
  open: boolean;
  /** The surface this was opened from — it IS the scope, never a suggestion. */
  defaultScope: SectionScope;
}>();

const emit = defineEmits<{
  close: [];
  created: [];
}>();

const WHEN_TABS = [
  { id: "once", label: "Once" },
  { id: "repeats", label: "Repeats" },
];

const FREQUENCIES: { id: RepeatFrequency; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

const WEEKDAYS = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 0, label: "Sun" },
];

const prompt = ref("");
const displayName = ref("");
const whenMode = ref<"once" | "repeats">("once");
const selectedPreset = ref<OneTimePreset | "custom">("in-15-minutes");
const customFireAt = ref("");
const frequency = ref<RepeatFrequency>("daily");
const time = ref("09:00");
const weekday = ref(1);
const dayOfMonth = ref(1);

const createSchedule = useCreateSchedule();

// `immediate` covers a dialog mounted already-open.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    prompt.value = "";
    displayName.value = "";
    whenMode.value = "once";
    selectedPreset.value = "in-15-minutes";
    customFireAt.value = "";
    frequency.value = "daily";
    time.value = "09:00";
    weekday.value = 1;
    dayOfMonth.value = 1;
    createSchedule.reset();
  },
  { immediate: true },
);

// Validity only — the actual instant is built at Create-click so a dialog
// left open doesn't submit a stale "in 15 minutes".
const isCustomPickValid = computed(() => {
  if (customFireAt.value === "") return false;
  const picked = new Date(customFireAt.value);
  return !Number.isNaN(picked.getTime()) && picked.getTime() > Date.now();
});

const isDayOfMonthValid = computed(
  () =>
    Number.isInteger(dayOfMonth.value) &&
    dayOfMonth.value >= 1 &&
    dayOfMonth.value <= 28,
);

const canCreate = computed(() => {
  if (prompt.value.trim().length === 0) return false;
  if (createSchedule.isPending.value) return false;
  if (whenMode.value === "once") {
    return selectedPreset.value !== "custom" || isCustomPickValid.value;
  }
  if (time.value === "") return false;
  return frequency.value !== "monthly" || isDayOfMonthValid.value;
});

const errorMessage = computed(() =>
  createSchedule.error.value
    ? formatSdkError(createSchedule.error.value)
    : null,
);

function create() {
  if (!canCreate.value) return;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const name = displayName.value.trim();
  // Both branches run a REAL Claude turn: templateKind 'custom' + chat-only.
  // ('reminder' would deliver the text verbatim without running Claude, and
  // its template defaults to channel delivery, which 400s without a channel.)
  const shared = {
    templateKind: "custom" as const,
    destinationKind: "chat-only" as const,
    promptTemplate: prompt.value.trim(),
    timezone,
    ...(name.length > 0 ? { displayName: name } : {}),
  };
  const fireAt =
    whenMode.value === "once"
      ? selectedPreset.value !== "custom"
        ? fireAtFromPreset(selectedPreset.value, new Date())
        : new Date(customFireAt.value)
      : null;
  const when =
    fireAt !== null
      ? { fireAt: fireAt.toISOString() }
      : {
          cronExpression: buildCronExpression({
            frequency: frequency.value,
            time: time.value,
            ...(frequency.value === "weekly" ? { weekday: weekday.value } : {}),
            ...(frequency.value === "monthly"
              ? { dayOfMonth: dayOfMonth.value }
              : {}),
          }),
        };
  createSchedule.mutate(
    props.defaultScope.kind === "workspace"
      ? {
          scope: "workspace",
          workspaceId: props.defaultScope.workspaceId,
          ...shared,
          ...when,
        }
      : { scope: "global", ...shared, ...when },
    { onSuccess: () => emit("created") },
  );
}

// Modal owns Esc / backdrop / focus-trap / scroll-lock; it reports close via
// update:open, which we forward to the parent as `close`.
function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="New schedule"
    description="Claude runs it on time and the result lands in your chat."
    size="md"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">What should Claude do?</span>
        <textarea
          v-model="prompt"
          rows="3"
          autofocus
          placeholder="e.g. Summarize my unread messages and what needs attention today."
          class="w-full resize-y rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <div class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">When</span>
        <SegmentedTabs
          :tabs="WHEN_TABS"
          :model-value="whenMode"
          @update:model-value="(id) => (whenMode = id as 'once' | 'repeats')"
        />

        <div v-if="whenMode === 'once'" class="grid gap-2">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in ONE_TIME_PRESETS"
              :key="preset.id"
              type="button"
              class="cursor-default rounded-full border px-3 py-1 text-[11.5px] font-medium transition"
              :class="
                selectedPreset === preset.id
                  ? 'border-gold bg-gold-soft text-ink-1'
                  : 'border-hair bg-panel text-ink-2 hover:border-hair-strong hover:text-ink-1'
              "
              :aria-pressed="selectedPreset === preset.id"
              @click="selectedPreset = preset.id"
            >
              {{ preset.label }}
            </button>
            <button
              type="button"
              class="cursor-default rounded-full border px-3 py-1 text-[11.5px] font-medium transition"
              :class="
                selectedPreset === 'custom'
                  ? 'border-gold bg-gold-soft text-ink-1'
                  : 'border-hair bg-panel text-ink-2 hover:border-hair-strong hover:text-ink-1'
              "
              :aria-pressed="selectedPreset === 'custom'"
              @click="selectedPreset = 'custom'"
            >
              Pick a time…
            </button>
          </div>
          <input
            v-if="selectedPreset === 'custom'"
            v-model="customFireAt"
            type="datetime-local"
            aria-label="Fire at"
            class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
          />
          <p
            v-if="selectedPreset === 'custom' && customFireAt && !isCustomPickValid"
            class="m-0 text-[11.5px] text-gold"
          >
            Pick a moment in the future.
          </p>
        </div>

        <div v-else class="grid gap-2">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="option in FREQUENCIES"
              :key="option.id"
              type="button"
              class="cursor-default rounded-full border px-3 py-1 text-[11.5px] font-medium transition"
              :class="
                frequency === option.id
                  ? 'border-gold bg-gold-soft text-ink-1'
                  : 'border-hair bg-panel text-ink-2 hover:border-hair-strong hover:text-ink-1'
              "
              :aria-pressed="frequency === option.id"
              @click="frequency = option.id"
            >
              {{ option.label }}
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-2.5">
            <label class="inline-flex items-center gap-[7px]">
              <span class="text-[11.5px] font-medium text-ink-3">At</span>
              <input
                v-model="time"
                type="time"
                class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
              />
            </label>

            <div v-if="frequency === 'weekly'" class="flex flex-wrap gap-1.5">
              <button
                v-for="day in WEEKDAYS"
                :key="day.id"
                type="button"
                class="cursor-default rounded-full border px-[9px] py-[3px] text-[10.5px] font-medium transition"
                :class="
                  weekday === day.id
                    ? 'border-gold bg-gold-soft text-ink-1'
                    : 'border-hair bg-panel text-ink-2 hover:border-hair-strong hover:text-ink-1'
                "
                :aria-pressed="weekday === day.id"
                @click="weekday = day.id"
              >
                {{ day.label }}
              </button>
            </div>

            <label
              v-if="frequency === 'monthly'"
              class="inline-flex items-center gap-[7px]"
            >
              <span class="text-[11.5px] font-medium text-ink-3">on day</span>
              <input
                v-model.number="dayOfMonth"
                type="number"
                min="1"
                max="28"
                class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1"
              />
              <span class="text-[11.5px] font-medium text-ink-3">(1–28, so it fires every month)</span>
            </label>
          </div>
        </div>
      </div>

      <label class="grid gap-1.5">
        <span class="text-[11.5px] font-semibold text-ink-2">
          Name
          <span class="text-[10px] font-medium uppercase tracking-wide text-ink-3">optional</span>
        </span>
        <input
          v-model="displayName"
          type="text"
          maxlength="200"
          placeholder="e.g. Morning digest"
          class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
        />
      </label>

      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canCreate"
        @click="create"
      >
        {{ createSchedule.isPending.value ? "Creating…" : "Create schedule" }}
      </button>
    </template>
  </Modal>
</template>
