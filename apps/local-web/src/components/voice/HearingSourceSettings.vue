<script setup lang="ts">
import { computed } from "vue";
import { useVoiceProviders } from "../../composables/voice/use-voice-providers.js";
import type { UserPreferencesPatch } from "../../composables/users/use-user-preferences.js";

// Settings → Voice, "Hearing · conversation": who transcribes what you say
// while a Vynel window is listening. Web speech is the default (free,
// word-by-word); a connected cloud provider transcribes per phrase. The
// wake word is a separate, always-local concern (the section below this).

const props = defineProps<{
  sttSource: string;
  saving: boolean;
}>();

const emit = defineEmits<{
  save: [patch: UserPreferencesPatch];
}>();

const providersQuery = useVoiceProviders();
const sttProviders = computed(
  () => (providersQuery.data.value ?? []).filter((provider) => provider.supports.stt),
);
</script>

<template>
  <h3 class="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Hearing · conversation</h3>
  <p class="m-0 text-xs text-ink-3">
    Who transcribes what you say while a Vynel window is listening. Web speech shows words as you
    speak; a cloud provider transcribes each phrase when you pause.
  </p>
  <label class="flex items-center gap-2 text-xs text-ink-2">
    <input
      type="radio"
      name="voice-stt-source"
      value="web-speech"
      :checked="props.sttSource === 'web-speech'"
      :disabled="saving"
      @change="emit('save', { voiceSttSource: 'web-speech' })"
    />
    Web speech recognition
    <span class="text-ink-3">(default — built into Chrome and Edge)</span>
  </label>
  <label v-for="provider in sttProviders" :key="provider.id" class="flex items-center gap-2 text-xs text-ink-2">
    <input
      type="radio"
      name="voice-stt-source"
      :value="provider.id"
      :checked="props.sttSource === provider.id"
      :disabled="!provider.connected || saving"
      @change="emit('save', { voiceSttSource: provider.id })"
    />
    {{ provider.label }}
    <span v-if="!provider.connected" class="text-ink-3">(connect it above first)</span>
  </label>
</template>
