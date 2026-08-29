<script setup lang="ts">
import { computed, ref } from "vue";
import { LOCAL_TTS_MODEL_IDS } from "@vynel/contracts/models/local-model-catalog";
import { VOICE_PROVIDER_CATALOG } from "@vynel/contracts/voice/voice-providers";
import {
  useUpdateUserPreferences,
  useUserPreferences,
} from "../../composables/users/use-user-preferences.js";
import { useVoiceProviders } from "../../composables/voice/use-voice-providers.js";
import { useReloadVoice } from "../../composables/voice/use-reload-voice.js";
import { useCurrentVoiceLabel } from "../../composables/voice/use-current-voice-label.js";

// WHICH VOICE, on the film screen (Chad, 2026-08-29). Changing it used to mean
// leaving for Settings → Voice, which is a long way from the take you are
// listening to — and the voice is the thing you re-judge on every playback.
// So it says the voice here, and changing it happens here.
//
// Only voices that can actually speak are offered: a local model that is not
// downloaded, or a provider that is not connected, would look like a choice and
// then be silent.

const preferencesQuery = useUserPreferences();
const updatePreferences = useUpdateUserPreferences();
const reloadVoice = useReloadVoice();
const providersQuery = useVoiceProviders();

const open = ref(false);
const preferences = computed(() => preferencesQuery.data.value ?? null);

const LOCAL_LABELS: Record<string, string> = {
  kokoro: "Kokoro",
  "piper-lessac": "Piper",
};

interface VoiceChoice {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly apply: () => void;
}

const choices = computed<VoiceChoice[]>(() => {
  const cloud = (providersQuery.data.value ?? [])
    .filter((provider) => provider.supports.tts && provider.connected)
    .map((provider) => ({
      id: `cloud:${provider.id}`,
      label: VOICE_PROVIDER_CATALOG[provider.id].label,
      hint: "cloud · paid",
      apply: () => save({ voiceTtsSource: provider.id }),
    }));
  const local = LOCAL_TTS_MODEL_IDS.map((id) => ({
    id: `local:${id}`,
    label: LOCAL_LABELS[id] ?? id,
    hint: "on this computer · free",
    apply: () => save({ voiceTtsSource: "local", voiceTtsModelId: id, voiceSpeakerId: 0 }),
  }));
  return [...cloud, ...local];
});

const currentLabel = useCurrentVoiceLabel();

const currentId = computed(() => {
  const source = preferences.value?.voiceTtsSource;
  if (source === undefined) return "";
  return source === "local"
    ? `local:${preferences.value?.voiceTtsModelId ?? ""}`
    : `cloud:${source}`;
});

function save(patch: Parameters<typeof updatePreferences.mutate>[0]): void {
  // Reload after saving, exactly as Settings does — the daemon has to load the
  // new voice before the next line is spoken.
  updatePreferences.mutate(patch, { onSuccess: () => reloadVoice.mutate(undefined) });
  open.value = false;
}
</script>

<template>
  <div class="voice-picker">
    <button
      type="button"
      class="current"
      data-testid="demo-voice-picker"
      :title="'Speaking with ' + currentLabel + ' — click to change'"
      @click="open = !open"
    >
      <span class="dot" :class="{ cloud: preferences?.voiceTtsSource !== 'local' }" />
      {{ currentLabel }}
      <span class="caret">▾</span>
    </button>

    <!-- Right here, not a page away. -->
    <div v-if="open" class="menu" role="menu">
      <button
        v-for="choice in choices"
        :key="choice.id"
        type="button"
        role="menuitem"
        class="choice"
        :class="{ on: choice.id === currentId }"
        :disabled="updatePreferences.isPending.value"
        @click="choice.apply()"
      >
        <span class="label">{{ choice.label }}</span>
        <span class="hint">{{ choice.hint }}</span>
      </button>
      <p class="note">Changing the voice re-records the takes in it.</p>
    </div>
  </div>
</template>

<style scoped>
.voice-picker {
  position: relative;
}

.current {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 600;
  cursor: default;
}

.current:hover {
  color: var(--ink-1);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
}

.dot.cloud {
  background: var(--gold);
}

.caret {
  color: var(--ink-3);
}

.menu {
  position: absolute;
  right: 0;
  z-index: 20;
  min-width: 210px;
  margin-top: 4px;
  padding: 4px;
  border: 1px solid var(--hair-strong);
  border-radius: 6px;
  background: var(--bg-panel);
  box-shadow: 0 10px 30px rgb(0 0 0 / 45%);
}

.choice {
  display: flex;
  width: 100%;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 9px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ink-1);
  font-size: 12px;
  text-align: left;
  cursor: default;
}

.choice:hover {
  background: var(--row-hover);
}

.choice.on {
  background: var(--row-active);
}

.hint {
  color: var(--ink-3);
  font-size: 10px;
}

.note {
  margin: 4px 9px 6px;
  color: var(--ink-3);
  font-size: 10px;
}
</style>
