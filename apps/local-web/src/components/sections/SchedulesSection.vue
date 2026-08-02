<script setup lang="ts">
import { computed, ref } from "vue";
import { CalendarClock, Plus, Repeat, Timer } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useSchedules } from "../../composables/schedules/use-schedules.js";
import { useToggleSchedule } from "../../composables/schedules/use-toggle-schedule.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import { describeScheduleCadence } from "../../utils/schedule-cadence.js";
import CreateScheduleDialog from "./CreateScheduleDialog.vue";
import SectionHeader from "./SectionHeader.vue";
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
  if (props.scope.kind === "global")
    return rows.filter((row) => row.workspaceId === null);
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
  <div class="flex flex-col gap-2.5">
    <SectionHeader
      :icon="CalendarClock"
      title="Schedules"
      subtitle="Briefings, reminders, and watches on Claude's own time"
    >
      <template v-if="schedules.length > 0" #actions>
        <button
          type="button"
          class="inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair px-2.5 py-0.5 text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="isCreateOpen = true"
        >
          <Plus :size="13" />
          New schedule
        </button>
      </template>
    </SectionHeader>

    <div v-if="schedules.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="schedule in schedules"
        :key="schedule.id"
        class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <span
          class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-info/10 text-info"
        >
          <Timer v-if="schedule.scheduleKind === 'one-time'" :size="17" />
          <Repeat v-else :size="17" />
        </span>
        <div class="row-main min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
              {{ schedule.displayName }}
            </p>
            <span
              class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ scopeLabel(schedule.workspaceId) }}</span
            >
          </div>
          <p class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
            {{ describeScheduleCadence(schedule) }} ·
            {{ nextFireNote(schedule.nextScheduledFireAt) }}
          </p>
        </div>
        <button
          type="button"
          class="pill inline-flex shrink-0 cursor-default items-center rounded-full border border-transparent px-2.5 py-0.5 text-[11px] font-semibold transition hover:border-hair-strong"
          :class="
            schedule.isEnabled
              ? 'is-on bg-ok/15 text-ok'
              : 'is-off bg-row-active text-ink-3'
          "
          :title="
            schedule.isEnabled ? 'Pause this schedule' : 'Resume this schedule'
          "
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
        <button
          type="button"
          class="inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="isCreateOpen = true"
        >
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
