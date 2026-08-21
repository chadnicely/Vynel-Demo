<script setup lang="ts">
import { computed } from "vue";
import { PhGraph as Graph } from "@phosphor-icons/vue";
import { useLocalModels } from "../../composables/models/use-local-models.js";
import { useLocalModelActions } from "../../composables/models/use-local-model-actions.js";
import LocalModelCard from "../models/LocalModelCard.vue";
import SectionHeader from "./SectionHeader.vue";

// Settings → Embedding: the one model behind memory + knowledge search — on
// this computer or not, downloadable now rather than silently on first use.
// One model by design (its 384 dimensions are baked into the search tables);
// a picker is a later move.

const modelsQuery = useLocalModels();
const actions = useLocalModelActions();

const embedding = computed(
  () => (modelsQuery.data.value ?? []).find((model) => model.kind === "embedding") ?? null,
);
const isBusy = computed(
  () => actions.download.isPending.value || actions.cancel.isPending.value || actions.remove.isPending.value,
);
const failure = computed(
  () => actions.download.error.value ?? actions.remove.error.value ?? actions.cancel.error.value ?? null,
);
</script>

<template>
  <div class="embedding-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="Graph"
      title="Embedding"
      subtitle="The model that lets Vynel search your memory and knowledge by meaning, not just by words. It runs on this computer."
    />

    <p v-if="modelsQuery.error.value" class="m-0 text-xs text-danger" role="alert">
      Couldn’t read the models on this computer — {{ modelsQuery.error.value.message }}
    </p>
    <p v-else-if="modelsQuery.isPending.value" class="m-0 text-xs text-ink-3">Checking…</p>

    <template v-else-if="embedding">
      <LocalModelCard
        :model="embedding"
        :busy="isBusy"
        removable
        @download="actions.download.mutate"
        @cancel="actions.cancel.mutate"
        @remove="actions.remove.mutate"
      />
      <p class="usage-note m-0 text-xs text-ink-3">
        <template v-if="embedding.state === 'installed'">
          Ready — new memory entries and knowledge files are indexed as they arrive.
        </template>
        <template v-else-if="embedding.state === 'downloading'">
          Search by meaning starts working as soon as this finishes.
        </template>
        <template v-else>
          Without it, Vynel downloads the model the first time it needs to search — download it now
          so search works right away, even offline.
        </template>
      </p>
    </template>

    <p v-if="failure" class="m-0 text-xs text-danger" role="alert">{{ failure.message }}</p>
  </div>
</template>
