<script setup lang="ts">
import { computed, ref } from "vue";
import { CalendarClock, Plus, Repeat, Timer } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useSchedules } from "../../composables/schedules/use-schedules.js";
import { useToggleSchedule } from "../../composables/schedules/use-toggle-schedule.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import { describeScheduleCadence } from "../../utils/schedule-cadence.js";
import CreateScheduleDialog from "./CreateScheduleDialog.vue";
import type { SectionScope } from "./section-scope.js";

// The schedules section, on either surface: what Claude does on its own time.
// Rows read as words ("Daily at 9:00 AM · next Fri 9:00 AM") and the pill
// pauses/resumes in place.
const props = defineProps<{
  scope: SectionScope;
}>();

const schedulesQuery = useSchedules(true);
const toggleSchedule = useToggleSchedule();
const { scopeLabel } = useScopeLabel();

const schedules = computed(() => {
  const rows = schedulesQuery.data.value ?? [];
  if (props.scope.kind === "global") return rows;
  const workspaceId = props.scope.workspaceId;
  return rows.filter(
    (row) => row.workspaceId === null || row.workspaceId === workspaceId,
  );
});

function nextFireNote(nextFireAt: string | null): string {
  if (!nextFireAt) return "not scheduled";
  return `next ${new Date(nextFireAt).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function toggle(schedule: { id: string; isEnabled: boolean }) {
  toggleSchedule.mutate({
    scheduleId: schedule.id,
    isEnabled: !schedule.isEnabled,
  });
}

const isCreateOpen = ref(false);

function onCreated() {
  isCreateOpen.value = false;
}
</script>

<template>
  <div class="schedules-section">
    <header class="section-header">
      <CalendarClock :size="15" class="section-icon" />
      <div class="section-text">
        <p class="section-title">Schedules</p>
        <p class="section-hint">Briefings, reminders, and watches on Claude's own time</p>
      </div>
      <button
        v-if="schedules.length > 0"
        type="button"
        class="add-button"
        @click="isCreateOpen = true"
      >
        <Plus :size="13" />
        New schedule
      </button>
    </header>

    <div v-if="schedules.length > 0" class="rows">
      <div v-for="schedule in schedules" :key="schedule.id" class="row">
        <span class="row-icon">
          <Timer v-if="schedule.scheduleKind === 'one-time'" :size="14" />
          <Repeat v-else :size="14" />
        </span>
        <div class="row-main">
          <p class="row-title">
            {{ schedule.displayName }}
            <span class="scope-chip">{{
              scopeLabel(schedule.workspaceId)
            }}</span>
          </p>
          <p class="row-sub">
            {{ describeScheduleCadence(schedule) }} ·
            {{ nextFireNote(schedule.nextScheduledFireAt) }}
          </p>
        </div>
        <button
          type="button"
          class="pill"
          :class="schedule.isEnabled ? 'is-on' : 'is-off'"
          :title="schedule.isEnabled ? 'Pause this schedule' : 'Resume this schedule'"
          @click="toggle(schedule)"
        >
          {{ schedule.isEnabled ? "On" : "Paused" }}
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      title="Nothing scheduled yet"
      hint="Have Claude work on its own time — a morning digest, a reminder in 15 minutes, a weekly summary."
    >
      <template #icon>
        <CalendarClock :size="22" />
      </template>
      <template #action>
        <button type="button" class="invite-button" @click="isCreateOpen = true">
          <Plus :size="13" />
          New schedule
        </button>
      </template>
    </EmptyState>

    <CreateScheduleDialog
      :open="isCreateOpen"
      :default-scope="props.scope"
      @close="isCreateOpen = false"
      @created="onCreated"
    />
  </div>
</template>

<style scoped>
.schedules-section {
  display: grid;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 2px 4px;
}

.section-icon {
  color: var(--ink-2);
  flex: none;
  margin-top: 2px;
}

.section-text {
  min-width: 0;
  flex: 1;
}

.section-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.section-hint {
  margin: 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.add-button,
.invite-button {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 11px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: transparent;
  color: var(--ink-2);
  font: 600 11.5px/1.6 var(--font-ui);
  cursor: default;
  flex: none;
  transition: border-color var(--t-fast) var(--ease-out);
}

.invite-button {
  border-color: var(--hair-strong);
  background: var(--bg-raised);
  padding: 5px 14px;
}

.add-button:hover,
.invite-button:hover {
  color: var(--ink-1);
  border-color: var(--hair-strong);
  background: var(--row-hover);
}

.add-button:focus-visible,
.invite-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.rows {
  display: grid;
  gap: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
}

.row-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-2);
  flex: none;
}

.row-main {
  min-width: 0;
  flex: 1;
}

.row-title {
  margin: 0;
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-sub {
  margin: 1px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scope-chip {
  color: var(--ink-3);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  padding: 0 6px;
}

/* The pill is the pause/resume control — same state colors as elsewhere. */
.pill {
  appearance: none;
  border: 1px solid transparent;
  margin: 0;
  flex: none;
  font: 600 11px/1.6 var(--font-ui);
  border-radius: 99px;
  padding: 1px 10px;
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.pill.is-on {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 14%, transparent);
}

.pill.is-off {
  color: var(--ink-3);
  background: var(--row-active);
}

.pill:hover {
  border-color: var(--hair-strong);
}

.pill:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
