<script setup lang="ts">
import { computed, ref } from "vue";
import { PhPlus as Plus, PhStack as Stack } from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import type {
  PhaseListItemResponse,
  PhaseStatus,
} from "@vynel/contracts/phases/phase-http";
import { usePhases } from "../../composables/phases/use-phases.js";
import { useUpdatePhase } from "../../composables/phases/use-update-phase.js";
import { useDeletePhase } from "../../composables/phases/use-delete-phase.js";
import EditPhaseDialog from "../phases/EditPhaseDialog.vue";
import PhaseViewDialog from "../phases/PhaseViewDialog.vue";
import SectionHeader from "./SectionHeader.vue";
import PhaseRow from "./PhaseRow.vue";

// The phases section — the workspace's build plan as ordered stages.
// Workspace-only by design: a phase orders a project's build, so (unlike
// Tasks) there is no global twin of this section. A phase's description is
// big-form, so creating goes through the dialog rather than a one-line
// composer.
const props = defineProps<{
  workspaceId: string;
}>();

const phasesQuery = usePhases(() => props.workspaceId);
const updatePhase = useUpdatePhase();
const deletePhase = useDeletePhase();

// Build order — the API returns it ordered; sorting here keeps the ordinal
// chips honest even mid-refetch after a reorder.
const phases = computed(() =>
  [...(phasesQuery.data.value ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  ),
);

function changeStatus(phase: PhaseListItemResponse, status: PhaseStatus) {
  updatePhase.mutate({
    workspaceId: props.workspaceId,
    phaseId: phase.id,
    status,
  });
}

function removePhase(phase: PhaseListItemResponse) {
  deletePhase.mutate({ workspaceId: props.workspaceId, phaseId: phase.id });
}

// One editor, both doors: null = create, a row = edit (the dialog fetches
// the full description itself).
const isEditorOpen = ref(false);
const editingPhase = ref<PhaseListItemResponse | null>(null);
const viewingPhase = ref<PhaseListItemResponse | null>(null);

// The viewed phase's build-order place, from the SAME sorted list the row
// chips read — one home for the ordinal rule (raw orderIndex drifts after a
// delete; the server never renumbers).
const viewingPosition = computed(() => {
  if (viewingPhase.value === null) return null;
  const index = phases.value.findIndex(
    (phase) => phase.id === viewingPhase.value!.id,
  );
  return index === -1 ? null : index + 1;
});

function openCreate() {
  editingPhase.value = null;
  isEditorOpen.value = true;
}

function openEdit(phase: PhaseListItemResponse) {
  editingPhase.value = phase;
  isEditorOpen.value = true;
}
</script>

<template>
  <div class="phases-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="Stack"
      title="Phases"
      subtitle="The build plan's ordered stages"
    >
      <template #actions>
        <button
          type="button"
          class="inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="openCreate"
        >
          <Plus :size="12" />
          New phase
        </button>
      </template>
    </SectionHeader>

    <div v-if="phases.length > 0" class="rows flex flex-col gap-2">
      <PhaseRow
        v-for="(phase, index) in phases"
        :key="phase.id"
        :phase="phase"
        :position="index + 1"
        @change-status="changeStatus(phase, $event)"
        @view="viewingPhase = phase"
        @edit="openEdit(phase)"
        @delete="removePhase(phase)"
      />
    </div>

    <EmptyState
      v-else
      title="No phases yet"
      hint="Ask Claude to lay out the build plan — or add the first phase above."
    >
      <template #icon>
        <Stack :size="22" />
      </template>
    </EmptyState>

    <EditPhaseDialog
      :open="isEditorOpen"
      :workspace-id="props.workspaceId"
      :phase="editingPhase"
      @close="isEditorOpen = false"
    />
    <PhaseViewDialog
      :open="viewingPhase !== null"
      :workspace-id="props.workspaceId"
      :phase="viewingPhase"
      :position="viewingPosition"
      @close="viewingPhase = null"
    />
  </div>
</template>
