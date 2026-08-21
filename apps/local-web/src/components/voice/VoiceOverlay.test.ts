// The overlay is this window's OTHER voice. What matters here is the ORDER it
// gives that voice up in: `use-display-voice.start()` closes the overlay and
// opens its own recognizer in the same tick, counting on this component to have
// ended its session by the time that line runs. Queued, the order inverts and
// the window holds two Web Speech sessions at once — which is why the whole
// case deliberately asserts BEFORE awaiting a tick.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useUiStore } from "../../stores/ui-store.js";
import type { VoiceCommandSessionView } from "../../composables/voice/voice-command-session-types.js";
import VoiceOverlay from "./VoiceOverlay.vue";

interface VoiceStub {
  view: Ref<VoiceCommandSessionView>;
  failure: Ref<string | null>;
  isActive: Ref<boolean>;
  start: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  currentSessionId: ReturnType<typeof vi.fn>;
  speakExternal: ReturnType<typeof vi.fn>;
}

const voice = vi.hoisted(() => ({}) as VoiceStub);

vi.mock("../../composables/voice/use-voice-session.js", async () => {
  const { computed, ref: reactiveRef } = await import("vue");
  voice.view = reactiveRef<VoiceCommandSessionView>({
    state: "ended",
    transcript: "",
    spokenText: "",
    notice: "",
  });
  voice.failure = reactiveRef<string | null>(null);
  voice.isActive = computed(
    () => voice.view.value.state !== "ended",
  ) as unknown as Ref<boolean>;
  voice.start = vi.fn(() => {
    voice.view.value = { state: "listening", transcript: "", spokenText: "", notice: "" };
  });
  voice.end = vi.fn(() => {
    voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  });
  voice.currentSessionId = vi.fn(() => null);
  voice.speakExternal = vi.fn(() => true);
  return { useVoiceSession: () => voice };
});

// The link needs the live channel and the injected client; this component's
// ownership of the MICROPHONE is what these cases are about.
vi.mock("../../composables/voice/use-voice-daemon-link.js", () => ({
  useVoiceDaemonLink: () => ({
    isDaemonConnected: ref(false),
    notifySessionEnd: vi.fn(),
  }),
}));

beforeEach(() => {
  setActivePinia(createPinia());
  voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  voice.start.mockClear();
  voice.end.mockClear();
});

describe("VoiceOverlay — handing the microphone over", () => {
  it("ends its session in the SAME tick the overlay is closed", () => {
    const ui = useUiStore();
    mount(VoiceOverlay, { global: { plugins: [] } });

    ui.isVoiceOverlayOpen = true;
    expect(voice.start).toHaveBeenCalledTimes(1);

    // No `await` on purpose: this is exactly the moment `use-display-voice`
    // opens its own recognizer, so ours must already be closed.
    ui.isVoiceOverlayOpen = false;
    expect(voice.end).toHaveBeenCalledTimes(1);
    expect(voice.isActive.value).toBe(false);
  });
});
