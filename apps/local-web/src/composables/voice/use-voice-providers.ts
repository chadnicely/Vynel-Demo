import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, type Ref } from "vue";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";

// Settings → Voice: the cloud providers a user can connect with their own
// API key. The key goes UP once through connect and never comes back — every
// read here is catalog + connection state.

export const voiceProviderKeys = {
  all: ["voice-providers"] as const,
  voices: (provider: string) => ["voice-providers", provider, "voices"] as const,
};

export type VoiceProviderStatus = Awaited<
  ReturnType<VynelClient["voiceProviders"]["list"]>
>[number];
export type VoiceProviderVoices = Awaited<ReturnType<VynelClient["voiceProviders"]["listVoices"]>>;
type VoiceProviderIdParam = Parameters<VynelClient["voiceProviders"]["connect"]>[0];

export function useVoiceProviders() {
  const vynel = useVynel();
  return useQuery({
    queryKey: voiceProviderKeys.all,
    queryFn: () => vynel.voiceProviders.list(),
  });
}

export function useConnectVoiceProvider() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: VoiceProviderIdParam; apiKey: string }) =>
      vynel.voiceProviders.connect(input.provider, { apiKey: input.apiKey }),
    onSuccess: (_status, input) => {
      void queryClient.invalidateQueries({ queryKey: voiceProviderKeys.all });
      // A rotated key may unlock a different account — the voices are news.
      void queryClient.invalidateQueries({ queryKey: voiceProviderKeys.voices(input.provider) });
    },
  });
}

export function useDisconnectVoiceProvider() {
  const vynel = useVynel();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: VoiceProviderIdParam) => vynel.voiceProviders.disconnect(provider),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: voiceProviderKeys.all }),
  });
}

/** A connected provider's voices for the picker — asked only while connected
 *  (an unconnected provider answers 409, which is not news worth polling). */
export function useVoiceProviderVoices(
  provider: Ref<VoiceProviderIdParam>,
  connected: Ref<boolean>,
) {
  const vynel = useVynel();
  return useQuery({
    queryKey: computed(() => voiceProviderKeys.voices(provider.value)),
    queryFn: () => vynel.voiceProviders.listVoices(provider.value),
    enabled: connected,
  });
}
