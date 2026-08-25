// Settings → Voice: the speaking and hearing models with their state, the
// pick of which to use (only among the installed), the speaker list for the
// chosen voice, and Remove kept away from the last voice standing.

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import type { LocalModelStatusResponse } from "@vynel/contracts/models/local-models-http";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { localModelKeys } from "../../composables/models/local-model-keys.js";
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
  voiceTtsSource: "local",
  voiceTtsProviderVoiceId: null,
  voiceSttSource: "web-speech",
};

function cloudProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: "elevenlabs",
    label: "ElevenLabs",
    tagline: "Natural voices from your ElevenLabs account.",
    connectHint: "Create an API key and paste it here.",
    credentialField: { key: "apiKey", label: "API key", placeholder: "xi-…" },
    supports: { tts: true, stt: true },
    connected: false,
    accountLabel: null,
    connectedAt: null,
    ...overrides,
  };
}

function harness(
  models: LocalModelStatusResponse[],
  preferences = DEFAULT_PREFERENCES,
  reloadAnswer: unknown = { reloaded: true, ttsModelId: "kokoro", sttModelId: "moonshine-base", speakerId: 5, changed: [], missing: [], ready: true },
  /** Later answers to the models list, one per refetch (the poll). */
  laterModels: LocalModelStatusResponse[][] = [],
  providers: ReturnType<typeof cloudProvider>[] = [cloudProvider(), cloudProvider({ id: "google", label: "Google Cloud" })],
) {
  const updatePreferences = vi.fn(async (patch: Record<string, unknown>) => ({ ...preferences, ...patch }));
  const reload = vi.fn(async () => reloadAnswer);
  const answers = [models, ...laterModels];
  const connect = vi.fn(async (provider: string) => {
    const row = providers.find((entry) => entry.id === provider)!;
    row.connected = true;
    return { ...row };
  });
  const disconnect = vi.fn(async () => undefined);
  const listVoices = vi.fn(async () => ({
    voices: [
      { id: "v-rachel", label: "Rachel", language: "en" },
      { id: "v-antoni", label: "Antoni", language: "en" },
    ],
  }));
  const client = {
    localModels: {
      list: async () => ({ models: answers.length > 1 ? answers.shift()! : answers[0]! }),
      download: vi.fn(async () => models[0]),
      cancelDownload: vi.fn(async () => ({ cancelled: true })),
      remove: vi.fn(async () => models[0]),
    },
    users: { getPreferences: async () => preferences, updatePreferences },
    voice: { reload },
    voiceProviders: { list: async () => providers.map((entry) => ({ ...entry })), connect, disconnect, listVoices },
  } as unknown as VynelClient;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(VoiceSettingsSection, {
    global: {
      plugins: [[VueQueryPlugin, { queryClient }] as [typeof VueQueryPlugin, unknown]],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  return { wrapper, updatePreferences, reload, queryClient, connect, disconnect, listVoices };
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
    expect(updatePreferences).toHaveBeenCalledWith({ voiceTtsModelId: "piper-lessac", voiceSpeakerId: 0, voiceTtsSource: "local" });
  });

  // The daemon boots on the pick: removing the model in use would leave Vynel
  // unable to start its voice — so the picked one is never removable, even
  // with another installed; the other installed one is.
  it("never offers Remove on the model in use, only on the others", async () => {
    const { wrapper } = harness([KOKORO, PIPER, MOONSHINE_BASE, MOONSHINE_TINY, VAD]);
    await flushPromises();
    const cards = wrapper.findAll(".model-card");
    expect(cards[0]!.find(".remove-button").exists()).toBe(false);
    expect(cards[2]!.find(".remove-button").exists()).toBe(false);

    const withTwo = harness([KOKORO, { ...PIPER, state: "installed" }, MOONSHINE_BASE, VAD]);
    await flushPromises();
    const twoCards = withTwo.wrapper.findAll(".model-card");
    expect(twoCards[0]!.find(".remove-button").exists()).toBe(false);
    expect(twoCards[1]!.find(".remove-button").exists()).toBe(true);
  });

  // Saved first, applied second: a pick is never lost to a dead daemon, and the
  // note says honestly whether it took.
  it("applies a saved pick to the running daemon and says so", async () => {
    const { wrapper, reload } = harness([KOKORO, PIPER, MOONSHINE_BASE, VAD]);
    await flushPromises();
    expect(wrapper.get(".apply-note").text()).toContain("next voice conversation");

    await wrapper.get(".speaker-pick select").setValue("5");
    await flushPromises();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".apply-note").text()).toBe("Applied.");
  });

  it("says when no daemon took the pick, and when the picked model is missing", async () => {
    const down = harness([KOKORO, PIPER, MOONSHINE_BASE, VAD], DEFAULT_PREFERENCES, {
      reloaded: false,
      reason: "the voice daemon is not running",
    });
    await flushPromises();
    await down.wrapper.get(".speaker-pick select").setValue("5");
    await flushPromises();
    expect(down.wrapper.get(".apply-note").text()).toContain("applies when the voice starts");

    const missing = harness([KOKORO, PIPER, MOONSHINE_BASE, VAD], DEFAULT_PREFERENCES, {
      reloaded: true,
      ttsModelId: "kokoro",
      sttModelId: "moonshine-base",
      speakerId: 0,
      changed: [],
      missing: ["piper-lessac"],
      ready: true,
    });
    await flushPromises();
    await missing.wrapper.get(".speaker-pick select").setValue("5");
    await flushPromises();
    expect(missing.wrapper.get(".apply-note").text()).toContain("piper-lessac is not downloaded yet");
  });

  it("offers Preview on the chosen, installed voice only", async () => {
    const { wrapper } = harness([KOKORO, PIPER, MOONSHINE_BASE, VAD]);
    await flushPromises();
    const cards = wrapper.findAll(".model-card");
    expect(cards[0]!.find(".preview-button").exists()).toBe(true);
    expect(cards[1]!.find(".preview-button").exists()).toBe(false);
  });

  // An installed app boots its daemon with no voice; the download that lands
  // the first models is the moment to tell it — the screen reloads once per
  // model that turns installed, never for what was already there on open.
  it("asks the daemon to reload when a download finishes, and says when it still has no voice", async () => {
    const missingKokoro = { ...KOKORO, state: "missing" as const };
    const { wrapper, reload, queryClient } = harness(
      [missingKokoro, MOONSHINE_BASE, VAD],
      DEFAULT_PREFERENCES,
      { reloaded: true, ttsModelId: "kokoro", sttModelId: "moonshine-base", speakerId: 0, changed: [], missing: ["kokoro"], ready: false },
      [[KOKORO, MOONSHINE_BASE, VAD]],
    );
    await flushPromises();
    expect(reload).not.toHaveBeenCalled();

    await queryClient.invalidateQueries({ queryKey: localModelKeys.all });
    await flushPromises();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".apply-note").text()).toContain("no voice yet");
  });

  it("tells the truth about who hears you: local wake word; the picked source (web speech by default) hears the rest", async () => {
    const { wrapper } = harness([KOKORO, PIPER, MOONSHINE_BASE, VAD]);
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Hearing · conversation");
    expect(text).toContain("Web speech recognition");
    expect(text).toContain("Hearing · wake word");
    expect(wrapper.get(".hearing-note").text()).toContain("always on this computer");
    expect(text).toContain("Use for the wake word");
    expect(text).not.toContain("Hear with this");
    expect(text).not.toContain("Everything runs on this computer");
    expect(wrapper.get(".vad-note").text()).toContain("Always on");
  });

  it("connect flow: the key goes up once and never renders back; connected unlocks the picks", async () => {
    const { wrapper, connect } = harness([KOKORO, PIPER, MOONSHINE_BASE, VAD]);
    await flushPromises();

    // Both providers offered, neither connected — their pick radios are locked.
    expect(wrapper.text()).toContain("Cloud voices");
    expect(wrapper.text()).toContain("connect it first");

    await wrapper.get(".voice-provider-card button").trigger("click"); // Connect…
    const keyInput = wrapper.get(".voice-provider-card input[type=password]");
    await keyInput.setValue("xi-super-secret");
    await wrapper.get(".voice-provider-card form").trigger("submit");
    await flushPromises();

    expect(connect).toHaveBeenCalledWith("elevenlabs", { apiKey: "xi-super-secret" });
    // The key never appears anywhere in the rendered section after connect.
    expect(wrapper.html()).not.toContain("xi-super-secret");
    expect(wrapper.text()).toContain("Connected");
  });

  it("a connected provider can be picked for speaking (with its voice) and for hearing", async () => {
    const providers = [
      cloudProvider({ connected: true, accountLabel: "starter" }),
      cloudProvider({ id: "google", label: "Google Cloud" }),
    ];
    const preferences = { ...DEFAULT_PREFERENCES, voiceTtsSource: "elevenlabs" };
    const { wrapper, updatePreferences, listVoices } = harness(
      [KOKORO, PIPER, MOONSHINE_BASE, VAD],
      preferences,
      undefined,
      [],
      providers,
    );
    await flushPromises();

    // Speaking already points at the provider — its voices were fetched live.
    expect(listVoices).toHaveBeenCalledWith("elevenlabs");
    const voiceSelect = wrapper.get(".voice-provider-card select");
    await voiceSelect.setValue("v-rachel");
    expect(updatePreferences).toHaveBeenCalledWith({ voiceTtsProviderVoiceId: "v-rachel" });
    // Let the save + reload settle — the hearing radios unlock again.
    await flushPromises();

    // Hearing: the connected provider is selectable; the source pick saves.
    const hearingRadios = wrapper.findAll("input[name=voice-stt-source]");
    expect(hearingRadios).toHaveLength(3); // web-speech + both providers
    await hearingRadios[1]!.setValue();
    expect(updatePreferences).toHaveBeenCalledWith({ voiceSttSource: "elevenlabs" });
    // Google is not connected — its hearing radio stays locked.
    expect((hearingRadios[2]!.element as HTMLInputElement).disabled).toBe(true);
  });
});
