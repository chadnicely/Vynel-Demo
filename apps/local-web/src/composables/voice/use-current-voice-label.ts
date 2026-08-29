import { computed, type ComputedRef } from "vue";
import { VOICE_PROVIDER_CATALOG } from "@vynel/contracts/voice/voice-providers";
import { useUserPreferences } from "../users/use-user-preferences.js";

// The name of the voice currently speaking — "Kokoro", "Piper", "ElevenLabs".
//
// ONE home, because two surfaces say it and they must never disagree: the film
// screen's picker, and the line it shows while recording ("Creating voice with
// Kokoro"). A pass in the wrong voice is only recognisable if that name is
// right.

const LOCAL_LABELS: Record<string, string> = {
  kokoro: "Kokoro",
  "piper-lessac": "Piper",
};

export function useCurrentVoiceLabel(): ComputedRef<string> {
  const preferencesQuery = useUserPreferences();
  return computed(() => {
    const preferences = preferencesQuery.data.value;
    if (preferences === undefined) return "the voice";
    const source = preferences.voiceTtsSource;
    if (source !== "local") return VOICE_PROVIDER_CATALOG[source].label;
    // An unknown id means a model retired between releases; its own id reads
    // better than a blank.
    return LOCAL_LABELS[preferences.voiceTtsModelId] ?? preferences.voiceTtsModelId;
  });
}
