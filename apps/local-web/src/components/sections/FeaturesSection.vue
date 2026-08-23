<script setup lang="ts">
import { computed, ref } from "vue";
import { PhPlus as Plus, PhSquaresFour as SquaresFour } from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import type {
  FeatureListItemResponse,
  FeatureStatus,
} from "@vynel/contracts/features/feature-http";
import { usePhases } from "../../composables/phases/use-phases.js";
import { useFeatures } from "../../composables/features/use-features.js";
import { useUpdateFeature } from "../../composables/features/use-update-feature.js";
import { useDeleteFeature } from "../../composables/features/use-delete-feature.js";
import EditFeatureDialog from "../features/EditFeatureDialog.vue";
import FeatureViewDialog from "../features/FeatureViewDialog.vue";
import SectionHeader from "./SectionHeader.vue";
import FeatureRow from "./FeatureRow.vue";

// The features section — what the workspace is building, grouped under the
// build plan's phases (the PlansSection day-group idiom, keyed by the loose
// `phaseId` ref instead of the date). Unplaced features close the list.
// Workspace-only by design, like Phases.
const props = defineProps<{
  workspaceId: string;
}>();

const phasesQuery = usePhases(() => props.workspaceId);
const featuresQuery = useFeatures(() => props.workspaceId);
const updateFeature = useUpdateFeature();
const deleteFeature = useDeleteFeature();

const phases = computed(() =>
  [...(phasesQuery.data.value ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  ),
);
const features = computed(() => featuresQuery.data.value ?? []);

// Phase groups in build order (only the ones with features), then the
// unplaced bucket. A feature whose phase was deleted (dangling loose ref)
// lands in "Not placed" rather than vanishing.
const featureGroups = computed(() => {
  const knownPhaseIds = new Set(phases.value.map((phase) => phase.id));
  const groups = phases.value
    .map((phase) => ({
      key: phase.id,
      label: phase.title,
      features: features.value.filter(
        (feature) => feature.phaseId === phase.id,
      ),
    }))
    .filter((group) => group.features.length > 0);
  const unplaced = features.value.filter(
    (feature) =>
      feature.phaseId === null || !knownPhaseIds.has(feature.phaseId),
  );
  if (unplaced.length > 0)
    groups.push({ key: "unplaced", label: "Not placed", features: unplaced });
  return groups;
});

function changeStatus(feature: FeatureListItemResponse, status: FeatureStatus) {
  updateFeature.mutate({
    workspaceId: props.workspaceId,
    featureId: feature.id,
    status,
  });
}

function removeFeature(feature: FeatureListItemResponse) {
  deleteFeature.mutate({
    workspaceId: props.workspaceId,
    featureId: feature.id,
  });
}

// One editor, both doors: null = create, a row = edit (the dialog fetches
// the full description itself).
const isEditorOpen = ref(false);
const editingFeature = ref<FeatureListItemResponse | null>(null);
const viewingFeature = ref<FeatureListItemResponse | null>(null);

function openCreate() {
  editingFeature.value = null;
  isEditorOpen.value = true;
}

function openEdit(feature: FeatureListItemResponse) {
  editingFeature.value = feature;
  isEditorOpen.value = true;
}
</script>

<template>
  <div class="features-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="SquaresFour"
      title="Features"
      subtitle="What this project is building, phase by phase"
    >
      <template #actions>
        <button
          type="button"
          class="inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
          @click="openCreate"
        >
          <Plus :size="12" />
          New feature
        </button>
      </template>
    </SectionHeader>

    <div v-if="featureGroups.length > 0" class="groups flex flex-col gap-3">
      <section
        v-for="group in featureGroups"
        :key="group.key"
        class="phase-group"
      >
        <h3
          class="group-label m-0 mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3"
        >
          {{ group.label }}
        </h3>
        <div class="rows flex flex-col gap-2">
          <FeatureRow
            v-for="feature in group.features"
            :key="feature.id"
            :feature="feature"
            @change-status="changeStatus(feature, $event)"
            @view="viewingFeature = feature"
            @edit="openEdit(feature)"
            @delete="removeFeature(feature)"
          />
        </div>
      </section>
    </div>

    <EmptyState
      v-else
      title="No features yet"
      hint="Ask Claude what to build — or add the first feature above."
    >
      <template #icon>
        <SquaresFour :size="22" />
      </template>
    </EmptyState>

    <EditFeatureDialog
      :open="isEditorOpen"
      :workspace-id="props.workspaceId"
      :feature="editingFeature"
      :phases="phases"
      @close="isEditorOpen = false"
    />
    <FeatureViewDialog
      :open="viewingFeature !== null"
      :workspace-id="props.workspaceId"
      :feature="viewingFeature"
      :phases="phases"
      @close="viewingFeature = null"
    />
  </div>
</template>
