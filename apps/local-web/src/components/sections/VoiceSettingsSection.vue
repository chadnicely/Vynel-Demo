<script setup lang="ts">
import { computed } from "vue";
import { PhSpeakerHigh as SpeakerHigh } from "@phosphor-icons/vue";
import type { LocalModelStatusResponse } from "@vynel/contracts/models/local-models-http";
import {
  LOCAL_STT_MODEL_IDS,
  LOCAL_TTS_MODEL_IDS,
  type LocalSttModelId,
  type LocalTtsModelId,
} from "@vynel/contracts/models/local-model-catalog";
import { useLocalModels } from "../../composables/models/use-local-models.js";
import { useLocalModelActions } from "../../composables/models/use-local-model-actions.js";
import {
  useUpdateUserPreferences,
  useUserPreferences,
} from "../../composables/users/use-user-preferences.js";
import LocalModelCard from "../models/LocalModelCard.vue";
import SectionHeader from "./SectionHeader.vue";

// Settings → Voice: the models Vynel speaks and hears with — which are on this
// computer, which one to use, and as whom. The pick is a user preference; the
// files are the machine's. A pick the user cannot hear yet (model not
// downloaded) is offered greyed, never hidden, so the next step is obvious.

const modelsQuery = useLocalModels();
const actions = useLocalModelActions();
const preferencesQuery = useUserPreferences();
const updatePreferences = useUpdateUserPreferences();

const models = computed(() => modelsQuery.data.value ?? []);
const ttsModels = computed(() => models.value.filter((model) => model.kind === "tts"));
const sttModels = computed(() => models.value.filter((model) => model.kind === "stt"));
const vadModel = computed(() => models.value.find((model) => model.kind === "vad") ?? null);

const preferences = computed(() => preferencesQuery.data.value ?? null);
const chosenTts = computed(
  () => ttsModels.value.find((model) => model.id === preferences.value?.voiceTtsModelId) ?? null,
);
const speakers = computed(() => chosenTts.value?.speakers ?? []);

const isBusy = computed(
  () => actions.download.isPending.value || actions.cancel.isPending.value || actions.remove.isPending.value,
);
const failure = computed(
  () =>
    actions.download.error.value ??
    actions.remove.error.value ??
    actions.cancel.error.value ??
    updatePreferences.error.value ??
    null,
);

// The last installed model of a kind keeps its Remove — taking it away would
// leave the voice with nothing to speak (or hear) with.
function isRemovable(model: LocalModelStatusResponse): boolean {
  const installedOfKind = models.value.filter(
    (row) => row.kind === model.kind && row.state === "installed",
  );
  return installedOfKind.length > 1 || model.id !== preferences.value?.[preferenceKeyFor(model)];
}

function preferenceKeyFor(model: LocalModelStatusResponse): "voiceTtsModelId" | "voiceSttModelId" {
  return model.kind === "tts" ? "voiceTtsModelId" : "voiceSttModelId";
}

function isTtsModelId(id: string): id is LocalTtsModelId {
  return LOCAL_TTS_MODEL_IDS.some((known) => known === id);
}

function isSttModelId(id: string): id is LocalSttModelId {
  return LOCAL_STT_MODEL_IDS.some((known) => known === id);
}

function chooseTts(modelId: string) {
  if (!isTtsModelId(modelId)) return;
  // A new model has its own speakers — start from its default voice.
  updatePreferences.mutate({ voiceTtsModelId: modelId, voiceSpeakerId: 0 });
}

function chooseStt(modelId: string) {
  if (isSttModelId(modelId)) updatePreferences.mutate({ voiceSttModelId: modelId });
}

function chooseSpeaker(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  if (Number.isInteger(value) && value >= 0) updatePreferences.mutate({ voiceSpeakerId: value });
}
</script>

<template>
  <div class="voice-settings-section flex flex-col gap-3">
    <SectionHeader
      :icon="SpeakerHigh"
      title="Voice"
      subtitle="How Vynel speaks and hears. Everything runs on this computer — download a voice once and it stays."
    />

    <p v-if="modelsQuery.error.value" class="m-0 text-xs text-danger" role="alert">
      Couldn’t read the models on this computer — {{ modelsQuery.error.value.message }}
    </p>
    <p v-else-if="modelsQuery.isPending.value || preferencesQuery.isPending.value" class="m-0 text-xs text-ink-3">
      Checking…
    </p>

    <template v-else>
      <section class="flex flex-col gap-2">
        <h3 class="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Speaking</h3>
        <LocalModelCard
          v-for="model in ttsModels"
          :key="model.id"
          :model="model"
          :busy="isBusy"
          :removable="isRemovable(model)"
          @download="actions.download.mutate"
          @cancel="actions.cancel.mutate"
          @remove="actions.remove.mutate"
        >
          <label class="tts-pick flex items-center gap-2 text-xs text-ink-2">
            <input
              type="radio"
              name="voice-tts"
              :value="model.id"
              :checked="preferences?.voiceTtsModelId === model.id"
              :disabled="model.state !== 'installed' || updatePreferences.isPending.value"
              @change="chooseTts(model.id)"
            />
            Speak with this
            <span v-if="model.state !== 'installed'" class="text-ink-3">(download it first)</span>
          </label>
          <label
            v-if="preferences?.voiceTtsModelId === model.id && speakers.length > 1"
            class="speaker-pick flex items-center gap-2 text-xs text-ink-2"
          >
            Voice
            <select
              class="rounded-sm border border-hair bg-inset px-2 py-1 text-xs text-ink-1"
              :value="preferences?.voiceSpeakerId ?? 0"
              :disabled="updatePreferences.isPending.value"
              @change="chooseSpeaker"
            >
              <option v-for="speaker in speakers" :key="speaker.id" :value="speaker.id">
                {{ speaker.name }} — {{ speaker.accent }}, {{ speaker.gender }}
              </option>
            </select>
          </label>
        </LocalModelCard>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Hearing</h3>
        <LocalModelCard
          v-for="model in sttModels"
          :key="model.id"
          :model="model"
          :busy="isBusy"
          :removable="isRemovable(model)"
          @download="actions.download.mutate"
          @cancel="actions.cancel.mutate"
          @remove="actions.remove.mutate"
        >
          <label class="stt-pick flex items-center gap-2 text-xs text-ink-2">
            <input
              type="radio"
              name="voice-stt"
              :value="model.id"
              :checked="preferences?.voiceSttModelId === model.id"
              :disabled="model.state !== 'installed' || updatePreferences.isPending.value"
              @change="chooseStt(model.id)"
            />
            Hear with this
            <span v-if="model.state !== 'installed'" class="text-ink-3">(download it first)</span>
          </label>
        </LocalModelCard>
        <LocalModelCard
          v-if="vadModel"
          :model="vadModel"
          :busy="isBusy"
          @download="actions.download.mutate"
          @cancel="actions.cancel.mutate"
        />
      </section>

      <p class="apply-note m-0 text-xs text-ink-3">
        A new pick is used from the next voice conversation on.
      </p>
    </template>

    <p v-if="failure" class="m-0 text-xs text-danger" role="alert">{{ failure.message }}</p>
  </div>
</template>
