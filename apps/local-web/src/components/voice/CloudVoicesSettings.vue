<script setup lang="ts">
import { computed, ref } from "vue";
import { PhPlay as Play } from "@phosphor-icons/vue";
import VoiceProviderCard from "./VoiceProviderCard.vue";
import {
  useConnectVoiceProvider,
  useDisconnectVoiceProvider,
  useVoiceProviders,
  useVoiceProviderVoices,
  type VoiceProviderStatus,
} from "../../composables/voice/use-voice-providers.js";
import type {
  UserPreferences,
  UserPreferencesPatch,
} from "../../composables/users/use-user-preferences.js";

// Settings → Voice, the "Cloud voices" block: connect ElevenLabs / Google
// with an API key (sealed engine-side, never returned), pick one as the
// speaking source, pick its voice from the account's live list. The parent
// owns saving (save → reload) and the Preview player; this block owns
// everything provider-shaped.

const props = defineProps<{
  preferences: UserPreferences | null;
  saving: boolean;
  previewing: boolean;
}>();

const emit = defineEmits<{
  save: [patch: UserPreferencesPatch];
  preview: [];
}>();

const providersQuery = useVoiceProviders();
const connectProvider = useConnectVoiceProvider();
const disconnectProvider = useDisconnectVoiceProvider();
const ttsProviders = computed(
  () => (providersQuery.data.value ?? []).filter((provider) => provider.supports.tts),
);
const ttsSource = computed(() => props.preferences?.voiceTtsSource ?? "local");
const selectedTtsProvider = computed(
  () => ttsProviders.value.find((provider) => provider.id === ttsSource.value) ?? null,
);

// Voices are fetched live for the SELECTED, connected provider only — the
// picker is the only reader. Google's list is huge; the optgroups keep it
// navigable by language.
const providerVoicesQuery = useVoiceProviderVoices(
  computed(() => selectedTtsProvider.value?.id ?? "elevenlabs"),
  computed(() => selectedTtsProvider.value?.connected ?? false),
);
const providerVoicesByLanguage = computed(() => {
  const groups = new Map<string, { id: string; label: string }[]>();
  for (const voice of providerVoicesQuery.data.value?.voices ?? []) {
    const language = voice.language ?? "other";
    const group = groups.get(language) ?? [];
    group.push({ id: voice.id, label: voice.label });
    groups.set(language, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
});

// Which provider a failed connect belongs to — the message renders on that
// card, not globally.
const connectingProvider = ref<string | null>(null);
function connectFailureFor(provider: VoiceProviderStatus): string | null {
  if (connectingProvider.value !== provider.id) return null;
  return connectProvider.error.value?.message ?? null;
}
function connect(provider: VoiceProviderStatus, apiKey: string) {
  connectingProvider.value = provider.id;
  connectProvider.mutate({ provider: provider.id, apiKey });
}
const providerBusy = computed(
  () => connectProvider.isPending.value || disconnectProvider.isPending.value,
);

function chooseTtsProvider(provider: VoiceProviderStatus) {
  if (provider.connected) emit("save", { voiceTtsSource: provider.id });
}
function chooseProviderVoice(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value) emit("save", { voiceTtsProviderVoiceId: value });
}
</script>

<template>
  <h4 class="m-0 mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Cloud voices</h4>
  <p class="m-0 text-xs text-ink-3">
    Use your own ElevenLabs or Google Cloud account for speaking. Your API key is verified,
    encrypted on this computer, and never shown again.
  </p>
  <VoiceProviderCard
    v-for="provider in ttsProviders"
    :key="provider.id"
    :provider="provider"
    :busy="providerBusy"
    :failure-message="connectFailureFor(provider)"
    @connect="(apiKey) => connect(provider, apiKey)"
    @disconnect="disconnectProvider.mutate(provider.id)"
  >
    <label class="flex items-center gap-2 text-xs text-ink-2">
      <input
        type="radio"
        name="voice-tts"
        :value="provider.id"
        :checked="ttsSource === provider.id"
        :disabled="!provider.connected || saving"
        @change="chooseTtsProvider(provider)"
      />
      Speak with this
      <span v-if="!provider.connected" class="text-ink-3">(connect it first)</span>
    </label>
    <div v-if="ttsSource === provider.id && provider.connected" class="flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-2 text-xs text-ink-2">
        Voice
        <select
          class="max-w-64 rounded-sm border border-hair bg-inset px-2 py-1 text-xs text-ink-1"
          :value="preferences?.voiceTtsProviderVoiceId ?? ''"
          :disabled="saving || providerVoicesQuery.isPending.value"
          @change="chooseProviderVoice"
        >
          <option value="" disabled>
            {{ providerVoicesQuery.isPending.value ? "Loading voices…" : "Pick a voice" }}
          </option>
          <optgroup v-for="[language, voices] in providerVoicesByLanguage" :key="language" :label="language">
            <option v-for="voice in voices" :key="voice.id" :value="voice.id">{{ voice.label }}</option>
          </optgroup>
        </select>
      </label>
      <button
        type="button"
        class="preview-button flex cursor-default items-center gap-1 rounded-sm border border-hair-strong px-3 py-1 text-[11px] font-semibold text-ink-2 transition hover:text-ink-1 disabled:opacity-60"
        :disabled="previewing || !preferences?.voiceTtsProviderVoiceId"
        @click="emit('preview')"
      >
        <Play :size="12" /> {{ previewing ? "Playing…" : "Preview" }}
      </button>
      <p v-if="providerVoicesQuery.error.value" class="m-0 w-full text-xs text-danger" role="alert">
        {{ providerVoicesQuery.error.value.message }}
      </p>
    </div>
  </VoiceProviderCard>
</template>
