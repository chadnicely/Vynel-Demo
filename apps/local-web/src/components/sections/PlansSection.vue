<script setup lang="ts">
import { computed, ref } from "vue";
import { CalendarRange, Plus } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import type { PlanResponse, PlanStatus } from "@vynel/contracts/plans/plan-http";
import { usePlans } from "../../composables/plans/use-plans.js";
import { useCreatePlan } from "../../composables/plans/use-create-plan.js";
import { useUpdatePlan } from "../../composables/plans/use-update-plan.js";
import { useDeletePlan } from "../../composables/plans/use-delete-plan.js";
import {
  formatDayLabel,
  localDayKey,
} from "../../utils/format-day-label.js";
import SectionHeader from "./SectionHeader.vue";
import PlanRow from "./PlanRow.vue";
import type { SectionScope } from "./section-scope.js";

// The plans section, on either surface: what each day is for. Rows group
// under day headers (newest day first — the list read the API already
// returns); the composer adds inline with a date that defaults to today.
// Done plans stay in their day group, dimmed — a plan is anchored to its
// day, so there is no cross-day archive fold like tasks'.
const props = defineProps<{
  scope: SectionScope;
}>();

const plansQuery = usePlans(true);
const createPlan = useCreatePlan();
const updatePlan = useUpdatePlan();
const deletePlan = useDeletePlan();

const plans = computed(() => {
  const rows = plansQuery.data.value ?? [];
  if (props.scope.kind === "global") return rows;
  const workspaceId = props.scope.workspaceId;
  return rows.filter(
    (row) => row.workspaceId === null || row.workspaceId === workspaceId,
  );
});

// Day groups preserving the list's newest-day-first order.
const dayGroups = computed(() => {
  const groups: { day: string; plans: PlanResponse[] }[] = [];
  for (const plan of plans.value) {
    const group = groups.at(-1);
    if (group && group.day === plan.planDate) group.plans.push(plan);
    else groups.push({ day: plan.planDate, plans: [plan] });
  }
  return groups;
});

const newPlanTitle = ref("");
const newPlanDate = ref(localDayKey());

function addPlan() {
  const title = newPlanTitle.value.trim();
  if (
    title.length === 0 ||
    newPlanDate.value.length === 0 ||
    createPlan.isPending.value
  )
    return;
  const planDate = newPlanDate.value;
  createPlan.mutate(
    props.scope.kind === "workspace"
      ? {
          scope: "workspace",
          workspaceId: props.scope.workspaceId,
          title,
          planDate,
        }
      : { scope: "global", title, planDate },
    { onSuccess: () => (newPlanTitle.value = "") },
  );
}

function changeStatus(plan: PlanResponse, status: PlanStatus) {
  updatePlan.mutate({ planId: plan.id, status });
}

function removePlan(plan: PlanResponse) {
  deletePlan.mutate({ planId: plan.id });
}
</script>

<template>
  <div class="plans-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="CalendarRange"
      title="Plans"
      subtitle="What each day is for — with its tasks underneath"
    />

    <form
      class="composer flex items-center gap-2 rounded-lg border border-hair bg-raised py-1.5 pl-3 pr-1.5 transition focus-within:border-hair-strong"
      @submit.prevent="addPlan"
    >
      <Plus :size="15" class="shrink-0 text-ink-3" />
      <input
        v-model="newPlanTitle"
        type="text"
        placeholder="Plan a day…"
        aria-label="New plan title"
        class="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink-1 outline-none placeholder:text-ink-3"
      />
      <input
        v-model="newPlanDate"
        type="date"
        aria-label="New plan date"
        class="shrink-0 border-0 bg-transparent text-xs text-ink-2 outline-none"
      />
      <button
        type="submit"
        class="add-button inline-flex shrink-0 cursor-default items-center rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition enabled:hover:border-hair-strong enabled:hover:bg-row-hover enabled:hover:text-ink-1 disabled:opacity-50"
        :disabled="newPlanTitle.trim().length === 0 || newPlanDate.length === 0"
      >
        Add
      </button>
    </form>

    <div v-if="dayGroups.length > 0" class="groups flex flex-col gap-3">
      <section v-for="group in dayGroups" :key="group.day" class="day-group">
        <h3
          class="day-label m-0 mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3"
        >
          {{ formatDayLabel(group.day) }}
        </h3>
        <div class="rows flex flex-col gap-2">
          <PlanRow
            v-for="plan in group.plans"
            :key="plan.id"
            :plan="plan"
            @change-status="changeStatus(plan, $event)"
            @delete="removePlan(plan)"
          />
        </div>
      </section>
    </div>

    <EmptyState
      v-else
      title="No days planned yet"
      hint="Tell Claude what a day is for — or add a plan above."
    >
      <template #icon>
        <CalendarRange :size="22" />
      </template>
    </EmptyState>
  </div>
</template>
