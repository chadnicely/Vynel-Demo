import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import type { VoiceCommandSessionView } from "../voice/voice-command-session-types.js";
import { createSpokenAudioPlayer } from "../voice/spoken-audio-player.js";
import {
  activityEnergy,
  displayOrbState,
  useSpokenClauseSpike,
} from "./display-orb-state.js";

function view(
  overrides: Partial<VoiceCommandSessionView> = {},
): VoiceCommandSessionView {
  return { state: "ended", transcript: "", spokenText: "", notice: "", ...overrides };
}

describe("activityEnergy", () => {
  // An orb at zero reads as an app that died — idle still has to burn.
  it("ranks working over needs-input over idle, and never rests at zero", () => {
    expect(activityEnergy("working")).toBeGreaterThan(activityEnergy("needs-input"));
    expect(activityEnergy("needs-input")).toBeGreaterThan(activityEnergy("idle"));
    expect(activityEnergy("idle")).toBeGreaterThan(0);
  });
});

describe("displayOrbState", () => {
  it("an idle room with no session sits at its resting energy, dark and deaf", () => {
    expect(displayOrbState(view(), activityEnergy("idle"), false)).toEqual({
      energy: activityEnergy("idle"),
      listening: false,
      speaking: false,
    });
  });

  // The mic stays open THROUGH the reply (voice-realtime VR2) — the orb shows
  // listening beside a thinking or speaking core, never instead of it.
  it("listens in every live phase and speaks only while the player plays", () => {
    const listening = displayOrbState(view({ state: "listening" }), 0.2, false);
    expect([listening.listening, listening.speaking]).toEqual([true, false]);

    const speaking = displayOrbState(view({ state: "speaking" }), 0.2, false);
    expect([speaking.listening, speaking.speaking]).toEqual([true, true]);

    const thinking = displayOrbState(view({ state: "thinking" }), 0.2, false);
    expect([thinking.listening, thinking.speaking]).toEqual([true, false]);
  });

  it("a live voice turn lifts the orb above the fleet's resting level", () => {
    expect(displayOrbState(view({ state: "speaking" }), 0.22, false).energy).toBeGreaterThan(
      displayOrbState(view({ state: "thinking" }), 0.22, false).energy,
    );
    expect(displayOrbState(view({ state: "thinking" }), 0.22, false).energy).toBeGreaterThan(
      0.22,
    );
  });

  // A quiet mic must not hide that the fleet is busy.
  it("never dims below the resting energy — a working fleet outranks a silent session", () => {
    expect(displayOrbState(view(), activityEnergy("working"), false).energy).toBe(
      activityEnergy("working"),
    );
  });

  it("mute silences the dials but keeps the room's own energy", () => {
    const muted = displayOrbState(view({ state: "speaking" }), activityEnergy("working"), true);
    expect(muted).toEqual({
      energy: activityEnergy("working"),
      listening: false,
      speaking: false,
    });
  });

  // A schedule's line relayed to this window, or the daemon's own speaker: the
  // assistant IS talking, with no turn of ours behind it.
  it("speaks for another producer's line with no session of its own", () => {
    const relayed = displayOrbState(view(), activityEnergy("idle"), false, true);
    expect(relayed.speaking).toBe(true);
    expect(relayed.energy).toBeGreaterThan(activityEnergy("idle"));
  });

  // Mute closes the MICROPHONE — it does not stop the assistant from talking.
  it("still speaks another producer's line while the mic is muted", () => {
    expect(displayOrbState(view(), activityEnergy("idle"), true, true)).toEqual({
      energy: displayOrbState(view({ state: "speaking" }), 0, false).energy,
      listening: false,
      speaking: true,
    });
  });
});

/** Mount a throwaway owner so `onUnmounted` is real. */
function mountSpike() {
  let spikeKey!: ReturnType<typeof useSpokenClauseSpike>;
  const wrapper = mount(
    defineComponent({
      setup() {
        spikeKey = useSpokenClauseSpike();
        return () => h("div");
      },
    }),
  );
  return { wrapper, spikeKey: () => spikeKey.value };
}

describe("useSpokenClauseSpike", () => {
  it("bumps once per spoken clause and detaches on unmount", async () => {
    const audio = stubBrowserAudio();
    const { wrapper, spikeKey } = mountSpike();
    const player = createSpokenAudioPlayer();

    await player.play("First clause. Second clause.");
    expect(spikeKey()).toBe(2);

    wrapper.unmount();
    await player.play("Third clause.");
    expect(spikeKey()).toBe(2);
    audio.restore();
  });
});

/** The browser bits the player reaches for — a WAV that plays and ends. */
function stubBrowserAudio() {
  const originals = {
    fetch: globalThis.fetch,
    Audio: globalThis.Audio,
    URL: globalThis.URL,
  };
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(["wav"])),
    })) as unknown as typeof fetch;
  globalThis.Audio = class {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) {}
    play(): Promise<void> {
      setTimeout(() => this.onended?.(), 0);
      return Promise.resolve();
    }
    pause(): void {}
  } as unknown as typeof Audio;
  globalThis.URL = {
    createObjectURL: () => "blob:test",
    revokeObjectURL: () => undefined,
  } as unknown as typeof URL;
  return {
    restore() {
      globalThis.fetch = originals.fetch;
      globalThis.Audio = originals.Audio;
      globalThis.URL = originals.URL;
    },
  };
}
