// Pins the composer-settings fallback LADDER (voice-session follow-up, Kafi
// 2026-08-19): the session row's persisted value wins, then the SURFACE's own
// never-set defaults (the Voice chat panel pins the voice tier), then the
// ui-store's new-chat defaults. Without the middle rung, a typed message in
// the Voice panel defaulted to the CHAT model instead of the voice tier.

import { describe, expect, it, vi } from "vitest";
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
import { useUiStore } from "../../stores/ui-store.js";
import {
  useSessionSettings,
  type ComposerSettings,
} from "./use-session-settings.js";

function mountSettings(input: {
  sessionId: string | null;
  locked?: boolean;
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
  const updateSettings = vi.fn(async () => ({
    sessionMode: null,
    selectedModel: null,
    thinkingEffort: null,
    autoBuildout: null,
  }));
  const client = {
    sessions: {
      updateSettings,
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
        { locked: () => input.locked === true },
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
  return Object.assign(() => captured, { updateSettings, ui: () => useUiStore() });
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

// A LOCKED surface (the hands-free voice thread) has no third layer to write
// to: with no session id, `update` would have rewritten the user's GLOBAL
// new-chat defaults from a composer that speaks for one thread only. It throws
// instead — loudly, because reaching it at all is a caller bug.
describe("useSessionSettings — a locked surface refuses writes", () => {
  it("throws instead of PATCHing the row or rewriting the local defaults", async () => {
    const harness = mountSettings({
      sessionId: "voice-seg-1",
      locked: true,
      surfaceDefaults: { modelId: VOICE_TIER_MODEL },
    });
    const settings = harness();
    await flushPromises();
    const ui = harness.ui();
    const modelBefore = ui.composerModelId;

    expect(() => settings.update({ modelId: "claude-opus-4-8" })).toThrow(/pinned/);
    expect(harness.updateSettings).not.toHaveBeenCalled();
    expect(ui.composerModelId).toBe(modelBefore);
  });

  it("with NO session id it still refuses — the dangerous branch is the local one", async () => {
    const harness = mountSettings({ sessionId: null, locked: true });
    const settings = harness();
    await flushPromises();
    const ui = harness.ui();

    expect(() => settings.update({ mode: "bypass" })).toThrow(/pinned/);
    expect(ui.composerMode).not.toBe("bypass");
  });

  it("an UNLOCKED surface is unchanged — the local defaults still take the write", async () => {
    const harness = mountSettings({ sessionId: null });
    const settings = harness();
    await flushPromises();
    settings.update({ modelId: "claude-opus-4-8" });
    expect(harness.ui().composerModelId).toBe("claude-opus-4-8");
  });
});
