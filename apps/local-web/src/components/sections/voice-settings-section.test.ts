// Settings → Voice: the speaking and hearing models with their state, the
// pick of which to use (only among the installed), the speaker list for the
// chosen voice, and Remove kept away from the last voice standing.

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import type { LocalModelStatusResponse } from "@vynel/contracts/models/local-models-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import VoiceSettingsSection from "./VoiceSettingsSection.vue";

function model(overrides: Partial<LocalModelStatusResponse>): LocalModelStatusResponse {
  return {
    id: "x",
    kind: "tts",
    label: "X",
    description: "",
    approxBytes: 1,
    speakers: null,
    state: "missing",
    installedAt: null,
    download: null,
    ...overrides,
  };
}

const KOKORO = model({
  id: "kokoro",
  label: "Kokoro",
  state: "installed",
  speakers: [
    { id: 0, name: "Default", accent: "American", gender: "female" },
    { id: 5, name: "Adam", accent: "American", gender: "male" },
  ],
});
const PIPER = model({ id: "piper-lessac", label: "Piper (Lessac)", speakers: [{ id: 0, name: "Lessac", accent: "American", gender: "male" }] });
const MOONSHINE_BASE = model({ id: "moonshine-base", kind: "stt", label: "Moonshine base", state: "installed" });
const MOONSHINE_TINY = model({ id: "moonshine-tiny", kind: "stt", label: "Moonshine tiny" });
const VAD = model({ id: "silero-vad", kind: "vad", label: "Silero VAD", state: "installed" });

const DEFAULT_PREFERENCES = {
  theme: "system",
  defaultWorkspaceId: null,
  chatStreamingEnabled: true,
  reducedMotion: false,
  voiceTtsModelId: "kokoro",
  voiceSpeakerId: 0,
  voiceSttModelId: "moonshine-base",
};

function harness(models: LocalModelStatusResponse[], preferences = DEFAULT_PREFERENCES) {
  const updatePreferences = vi.fn(async (patch: Record<string, unknown>) => ({ ...preferences, ...patch }));
  const client = {
    localModels: {
      list: async () => ({ models }),
      download: vi.fn(async () => models[0]),
      cancelDownload: vi.fn(async () => ({ cancelled: true })),
      remove: vi.fn(async () => models[0]),
    },
    users: { getPreferences: async () => preferences, updatePreferences },
  } as unknown as VynelClient;
  const wrapper = mount(VoiceSettingsSection, {
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ] as [typeof VueQueryPlugin, unknown],
      ],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  return { wrapper, updatePreferences };
}

describe("VoiceSettingsSection", () => {
  it("lists speaking and hearing models with the chosen ones ticked", async () => {
    const { wrapper } = harness([KOKORO, PIPER, MOONSHINE_BASE, MOONSHINE_TINY, VAD]);
    await flushPromises();
    const ttsPicks = wrapper.findAll(".tts-pick input");
    expect(ttsPicks.map((input) => (input.element as HTMLInputElement).checked)).toEqual([true, false]);
    const sttPicks = wrapper.findAll(".stt-pick input");
    expect(sttPicks.map((input) => (input.element as HTMLInputElement).checked)).toEqual([true, false]);
    expect(wrapper.findAll(".model-card")).toHaveLength(5);
  });

  it("only an installed model can be picked — the others say what to do first", async () => {
    const { wrapper } = harness([KOKORO, PIPER, MOONSHINE_BASE, MOONSHINE_TINY, VAD]);
    await flushPromises();
    const piperPick = wrapper.findAll(".tts-pick")[1]!;
    expect(piperPick.get("input").attributes("disabled")).toBeDefined();
    expect(piperPick.text()).toContain("download it first");
  });

  it("offers the chosen voice's speakers and saves the pick", async () => {
    const { wrapper, updatePreferences } = harness([KOKORO, PIPER, MOONSHINE_BASE, VAD]);
    await flushPromises();
    const select = wrapper.get(".speaker-pick select");
    expect(select.findAll("option").map((option) => option.text())).toEqual([
      "Default — American, female",
      "Adam — American, male",
    ]);
    await select.setValue("5");
    await flushPromises();
    expect(updatePreferences).toHaveBeenCalledWith({ voiceSpeakerId: 5 });
  });

  it("picking another installed voice resets the speaker to its default", async () => {
    const installedPiper = { ...PIPER, state: "installed" as const };
    const { wrapper, updatePreferences } = harness([KOKORO, installedPiper, MOONSHINE_BASE, VAD]);
    await flushPromises();
    await wrapper.findAll(".tts-pick input")[1]!.trigger("change");
    await flushPromises();
    expect(updatePreferences).toHaveBeenCalledWith({ voiceTtsModelId: "piper-lessac", voiceSpeakerId: 0 });
  });

  // Removing the voice in use with nothing else installed would leave Vynel
  // mute — the card keeps its Remove away in that one case.
  it("keeps Remove away from the only installed voice in use", async () => {
    const { wrapper } = harness([KOKORO, PIPER, MOONSHINE_BASE, MOONSHINE_TINY, VAD]);
    await flushPromises();
    const cards = wrapper.findAll(".model-card");
    expect(cards[0]!.find(".remove-button").exists()).toBe(false);
    expect(cards[2]!.find(".remove-button").exists()).toBe(false);

    const withTwo = harness([KOKORO, { ...PIPER, state: "installed" }, MOONSHINE_BASE, VAD]);
    await flushPromises();
    expect(withTwo.wrapper.findAll(".model-card")[0]!.find(".remove-button").exists()).toBe(true);
  });
});
