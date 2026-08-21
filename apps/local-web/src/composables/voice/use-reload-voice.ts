import { useMutation } from "@tanstack/vue-query";
import type { VoiceReloadResponse } from "@vynel/contracts/voice/voice-reload";
import { useVynel } from "../use-vynel.js";

/** Ask the running voice daemon to apply the saved voice pick now. A daemon
 *  that isn't running answers `reloaded: false` — the pick is saved either
 *  way and applies at its next start. */
export function useReloadVoice() {
  const vynel = useVynel();
  return useMutation({
    mutationFn: async () => (await vynel.voice.reload()) as VoiceReloadResponse,
  });
}
