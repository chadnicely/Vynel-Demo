// Pins the composer-settings fallback LADDER (voice-session follow-up, Kafi
// 2026-08-19): the session row's persisted value wins, then the SURFACE's own
// never-set defaults (the Voice chat panel pins the voice tier), then the
// ui-store's new-chat defaults. Without the middle rung, a typed message in
// the Voice panel defaulted to the CHAT model instead of the voice tier.

import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import {
  VOICE_TIER_MODEL,
  VOICE_TIER_THINKING_EFFORT,
} from "@vynel/contracts/chat/voice-tier";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import {
  useSessionSettings,
  type ComposerSettings,
} from "./use-session-settings.js";

function mountSettings(input: {
  sessionId: string | null;
  serverSettings?: {
    sessionMode: string | null;
    selectedModel: string | null;
    thinkingEffort: string | null;
    autoBuildout: boolean | null;
  };
  surfaceDefaults?: Partial<
    Pick<ComposerSettings, "modelId" | "thinkingEffort" | "mode">
  >;
}) {
  let captured!: ReturnType<typeof useSessionSettings>;
  const client = {
    sessions: {
      getSettings: async () =>
        input.serverSettings ?? {
          sessionMode: null,
          selectedModel: null,
          thinkingEffort: null,
          autoBuildout: null,
        },
    },
  } as unknown as VynelClient;

  const Host = defineComponent({
    setup() {
      captured = useSessionSettings(
        () => input.sessionId,
        input.surfaceDefaults,
      );
      return () => h("div");
    },
  });

  mount(Host, {
    global: {
      plugins: [
        createPinia(),
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false } },
            }),
          },
        ],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  return () => captured;
}

describe("useSessionSettings — the fallback ladder", () => {
  it("a surface's own defaults fill never-set fields (the Voice panel's tier)", async () => {
    const settings = mountSettings({
      sessionId: "voice-seg-1",
      surfaceDefaults: {
        modelId: VOICE_TIER_MODEL,
        thinkingEffort: VOICE_TIER_THINKING_EFFORT,
      },
    })();
    await flushPromises();
    expect(settings.values.value.modelId).toBe(VOICE_TIER_MODEL);
    expect(settings.values.value.thinkingEffort).toBe(
      VOICE_TIER_THINKING_EFFORT,
    );
  });

  it("a persisted row value still WINS over the surface defaults", async () => {
    const settings = mountSettings({
      sessionId: "voice-seg-1",
      serverSettings: {
        sessionMode: null,
        selectedModel: "claude-fable-5",
        thinkingEffort: null,
        autoBuildout: null,
      },
      surfaceDefaults: { modelId: VOICE_TIER_MODEL },
    })();
    await flushPromises();
    expect(settings.values.value.modelId).toBe("claude-fable-5");
  });

  it("without surface defaults the ui-store new-chat defaults apply (the chat surfaces, unchanged)", async () => {
    const settings = mountSettings({ sessionId: null })();
    await flushPromises();
    // The ui-store default (localStorage-less test env → DEFAULT_CHAT_MODEL).
    expect(settings.values.value.modelId).toBe("claude-opus-5");
  });
});
