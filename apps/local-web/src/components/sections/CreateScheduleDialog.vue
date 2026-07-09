<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { SegmentedTabs } from "@vynel/ui";
import { useCreateSchedule } from "../../composables/schedules/use-create-schedule.js";
import { useWorkspaceList } from "../../composables/workspaces/use-workspace-list.js";
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
// time). Scope picker mirrors the connect dialog: everywhere, or one room.
const props = defineProps<{
  open: boolean;
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
const scopeChoice = ref<string>("global");

const workspacesQuery = useWorkspaceList();
const workspaces = computed(() =>
  (workspacesQuery.data.value ?? []).filter((row) => !row.isArchived),
);

const createSchedule = useCreateSchedule();

// `immediate` covers a dialog mounted already-open (the watcher would
// otherwise never seed the scope).
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
    scopeChoice.value =
      props.defaultScope.kind === "workspace"
        ? props.defaultScope.workspaceId
        : "global";
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
    scopeChoice.value === "global"
      ? { scope: "global", ...shared, ...when }
      : { scope: "workspace", workspaceId: scopeChoice.value, ...shared, ...when },
    { onSuccess: () => emit("created") },
  );
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="dialog-backdrop"
      @pointerdown.self="emit('close')"
      @keydown="onKeydown"
    >
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New schedule"
      >
        <header class="dialog-header">
          <h2 class="dialog-title">New schedule</h2>
          <p class="dialog-subtitle">
            Claude runs it on time and the result lands in your chat.
          </p>
        </header>

        <label class="field">
          <span class="field-label">What should Claude do?</span>
          <textarea
            v-model="prompt"
            rows="3"
            autofocus
            placeholder="e.g. Summarize my unread messages and what needs attention today."
          />
        </label>

        <div class="field">
          <span class="field-label">When</span>
          <SegmentedTabs
            :tabs="WHEN_TABS"
            :model-value="whenMode"
            @update:model-value="(id) => (whenMode = id as 'once' | 'repeats')"
          />

          <div v-if="whenMode === 'once'" class="when-body">
            <div class="chips">
              <button
                v-for="preset in ONE_TIME_PRESETS"
                :key="preset.id"
                type="button"
                class="chip"
                :class="{ 'is-selected': selectedPreset === preset.id }"
                :aria-pressed="selectedPreset === preset.id"
                @click="selectedPreset = preset.id"
              >
                {{ preset.label }}
              </button>
              <button
                type="button"
                class="chip"
                :class="{ 'is-selected': selectedPreset === 'custom' }"
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
              class="datetime-input"
              aria-label="Fire at"
            />
            <p
              v-if="selectedPreset === 'custom' && customFireAt && !isCustomPickValid"
              class="field-warn"
            >
              Pick a moment in the future.
            </p>
          </div>

          <div v-else class="when-body">
            <div class="chips">
              <button
                v-for="option in FREQUENCIES"
                :key="option.id"
                type="button"
                class="chip"
                :class="{ 'is-selected': frequency === option.id }"
                :aria-pressed="frequency === option.id"
                @click="frequency = option.id"
              >
                {{ option.label }}
              </button>
            </div>

            <div class="cadence-row">
              <label class="inline-field">
                <span class="inline-label">At</span>
                <input v-model="time" type="time" class="time-input" />
              </label>

              <div v-if="frequency === 'weekly'" class="chips">
                <button
                  v-for="day in WEEKDAYS"
                  :key="day.id"
                  type="button"
                  class="chip is-compact"
                  :class="{ 'is-selected': weekday === day.id }"
                  :aria-pressed="weekday === day.id"
                  @click="weekday = day.id"
                >
                  {{ day.label }}
                </button>
              </div>

              <label v-if="frequency === 'monthly'" class="inline-field">
                <span class="inline-label">on day</span>
                <input
                  v-model.number="dayOfMonth"
                  type="number"
                  min="1"
                  max="28"
                  class="day-input"
                />
                <span class="inline-label">(1–28, so it fires every month)</span>
              </label>
            </div>
          </div>
        </div>

        <label class="field">
          <span class="field-label">
            Name <span class="optional-tag">optional</span>
          </span>
          <input
            v-model="displayName"
            type="text"
            maxlength="200"
            placeholder="e.g. Morning digest"
          />
        </label>

        <label class="field">
          <span class="field-label">Where it lives</span>
          <select v-model="scopeChoice" class="scope-select">
            <option value="global">Global — Claude everywhere</option>
            <option
              v-for="workspace in workspaces"
              :key="workspace.id"
              :value="workspace.id"
            >
              {{ workspace.name }} workspace
            </option>
          </select>
        </label>

        <p v-if="errorMessage" class="dialog-error" role="alert">
          {{ errorMessage }}
        </p>

        <footer class="dialog-actions">
          <button type="button" class="ghost" @click="emit('close')">
            Cancel
          </button>
          <button
            type="button"
            class="primary"
            :disabled="!canCreate"
            @click="create"
          >
            {{ createSchedule.isPending.value ? "Creating…" : "Create schedule" }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: var(--bg-overlay);
}

.dialog {
  width: min(480px, calc(100vw - 48px));
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-l);
  background: var(--bg-raised);
  box-shadow: var(--shadow-overlay);
}

.dialog-header {
  display: grid;
  gap: 3px;
}

.dialog-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 15px/1.4 var(--font-ui);
}

.dialog-subtitle {
  margin: 0;
  color: var(--ink-2);
  font: 400 12px/1.5 var(--font-ui);
}

.field {
  display: grid;
  gap: 6px;
}

.field-label {
  color: var(--ink-2);
  font: 600 11.5px/1.5 var(--font-ui);
}

.optional-tag {
  color: var(--ink-3);
  font: 500 10px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.field textarea,
.field input,
.scope-select {
  appearance: none;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 400 12.5px/1.55 var(--font-ui);
  resize: vertical;
}

.field textarea:focus-visible,
.field input:focus-visible,
.scope-select:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -1px;
}

.when-body {
  display: grid;
  gap: 8px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  appearance: none;
  margin: 0;
  padding: 4px 12px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: var(--bg-panel);
  color: var(--ink-2);
  font: 500 11.5px/1.5 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.chip.is-compact {
  padding: 3px 9px;
  font-size: 10.5px;
}

.chip:hover {
  color: var(--ink-1);
  border-color: var(--hair-strong);
}

.chip.is-selected {
  color: var(--ink-1);
  border-color: var(--gold);
  background: var(--gold-soft);
}

.chip:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.cadence-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.inline-field {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.inline-label {
  color: var(--ink-3);
  font: 500 11.5px/1.5 var(--font-ui);
}

.time-input,
.day-input,
.datetime-input {
  appearance: none;
  padding: 5px 9px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 400 12px/1.5 var(--font-ui);
}

.day-input {
  width: 64px;
}

.field-warn {
  margin: 0;
  color: var(--gold);
  font: 400 11.5px/1.5 var(--font-ui);
}

.dialog-error {
  margin: 0;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ghost,
.primary {
  appearance: none;
  border: 1px solid var(--hair-strong);
  margin: 0;
  padding: 6px 14px;
  border-radius: var(--radius-s);
  font: 600 12px/1.5 var(--font-ui);
  cursor: default;
}

.ghost {
  background: transparent;
  color: var(--ink-2);
}

.ghost:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.primary {
  border-color: transparent;
  background: var(--gold);
  color: #14171c;
}

.primary:hover:not(:disabled) {
  background: var(--gold-bright);
}

.primary:disabled {
  opacity: 0.55;
}

.ghost:focus-visible,
.primary:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
