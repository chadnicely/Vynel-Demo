import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import type { VoiceDaemonState } from "../voice/use-voice-daemon-link.js";
import type {
  VoiceCommandSessionState,
  VoiceCommandSessionView,
} from "../voice/voice-command-session-types.js";
import { createSpokenAudioPlayer } from "../voice/spoken-audio-player.js";
import {
  activityEnergy,
  displayOrbState,
  mirroredOrbState,
  useSpokenClauseSpike,
  type DisplayDaemonLeg,
} from "./display-orb-state.js";

function view(
  overrides: Partial<VoiceCommandSessionView> = {},
): VoiceCommandSessionView {
  return { state: "ended", transcript: "", spokenText: "", notice: "", ...overrides };
}

function daemonLeg(
  state: VoiceDaemonState,
  isPlayingRelayedLine = false,
): DisplayDaemonLeg {
  return { state, isPlayingRelayedLine };
}

/** The energies the room's OWN leg burns, read off the mapping rather than
 *  restated — the daemon leg has to land on exactly the same numbers. */
function speakingEnergy(): number {
  return displayOrbState(view({ state: "speaking" }), 0, false).energy;
}

function thinkingEnergy(): number {
  return displayOrbState(view({ state: "thinking" }), 0, false).energy;
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
    const relayed = displayOrbState(
      view(),
      activityEnergy("idle"),
      false,
      daemonLeg("idle", true),
    );
    expect(relayed.speaking).toBe(true);
    expect(relayed.energy).toBeGreaterThan(activityEnergy("idle"));
  });

  // Mute closes the MICROPHONE — it does not stop the assistant from talking.
  it("still speaks another producer's line while the mic is muted", () => {
    expect(
      displayOrbState(view(), activityEnergy("idle"), true, daemonLeg("idle", true)),
    ).toEqual({
      energy: speakingEnergy(),
      listening: false,
      speaking: true,
    });
  });
});

// The daemon leg: a wake answered natively, or one handed to the wake window
// while this room stayed open. Every combination of the two legs, spelled out —
// the precedence rule is the whole point, so nothing here is derived from it.
type OrbCase = [
  own: VoiceCommandSessionState,
  daemon: VoiceDaemonState,
  relayed: boolean,
  muted: boolean,
  listening: boolean,
  speaking: boolean,
];

const ORB_CASES: OrbCase[] = [
  // The room's own session holds the microphone — the daemon never adds a
  // second "listening" to it, whatever it is doing.
  ["listening", "idle", false, false, true, false],
  ["listening", "idle", true, false, true, true],
  ["listening", "listening", false, false, true, false],
  ["listening", "listening", true, false, true, true],
  ["listening", "speaking", false, false, true, true],
  ["listening", "speaking", true, false, true, true],
  // Muted: the room's microphone is closed, so the daemon's leg takes the orb.
  ["listening", "idle", false, true, false, false],
  ["listening", "idle", true, true, false, true],
  ["listening", "listening", false, true, true, false],
  ["listening", "listening", true, true, true, true],
  ["listening", "speaking", false, true, true, true],
  ["listening", "speaking", true, true, true, true],
  // The room speaking its own reply — its mic stays open through it.
  ["speaking", "idle", false, false, true, true],
  ["speaking", "idle", true, false, true, true],
  ["speaking", "listening", false, false, true, true],
  ["speaking", "listening", true, false, true, true],
  ["speaking", "speaking", false, false, true, true],
  ["speaking", "speaking", true, false, true, true],
  ["speaking", "idle", false, true, false, false],
  ["speaking", "idle", true, true, false, true],
  ["speaking", "listening", false, true, true, false],
  ["speaking", "listening", true, true, true, true],
  ["speaking", "speaking", false, true, true, true],
  ["speaking", "speaking", true, true, true, true],
  // No session of the room's own: the daemon leg is all the orb has.
  ["ended", "idle", false, false, false, false],
  ["ended", "idle", true, false, false, true],
  ["ended", "listening", false, false, true, false],
  ["ended", "listening", true, false, true, true],
  ["ended", "speaking", false, false, true, true],
  ["ended", "speaking", true, false, true, true],
  ["ended", "idle", false, true, false, false],
  ["ended", "idle", true, true, false, true],
  ["ended", "listening", false, true, true, false],
  ["ended", "listening", true, true, true, true],
  ["ended", "speaking", false, true, true, true],
  ["ended", "speaking", true, true, true, true],
];

describe("displayOrbState — the daemon leg", () => {
  it.each(ORB_CASES)(
    "own %s · daemon %s · relayed %s · muted %s → listening %s, speaking %s",
    (own, state, relayed, muted, listening, speaking) => {
      const orb = displayOrbState(
        view({ state: own }),
        activityEnergy("idle"),
        muted,
        daemonLeg(state, relayed),
      );
      expect([orb.listening, orb.speaking]).toEqual([listening, speaking]);
    },
  );

  // A handed-off conversation parks the daemon at 'wake' for its whole life —
  // that ONE phase is what mirrors the wake window into this room.
  it("mirrors a handed-off conversation, which never leaves 'wake'", () => {
    const orb = displayOrbState(view(), activityEnergy("idle"), false, daemonLeg("wake"));
    expect([orb.listening, orb.speaking]).toEqual([true, false]);
    // Awake and silent burns no more than the fleet does — nothing is running yet.
    expect(orb.energy).toBe(activityEnergy("idle"));
  });

  it("burns for the daemon's work at the same levels as the room's own", () => {
    const idle = activityEnergy("idle");
    expect(displayOrbState(view(), idle, false, daemonLeg("thinking")).energy).toBe(
      thinkingEnergy(),
    );
    expect(displayOrbState(view(), idle, false, daemonLeg("speaking")).energy).toBe(
      speakingEnergy(),
    );
    // Muted or not: the daemon's speaker is not this room's microphone.
    expect(displayOrbState(view(), idle, true, daemonLeg("speaking")).energy).toBe(
      speakingEnergy(),
    );
  });

  // Precedence again, on the energy dial: while the room owns the conversation
  // the daemon's phase is stale by definition and must not brighten anything.
  it("does not lift the orb for the daemon while the room owns the conversation", () => {
    expect(
      displayOrbState(
        view({ state: "listening" }),
        activityEnergy("idle"),
        false,
        daemonLeg("thinking"),
      ).energy,
    ).toBe(activityEnergy("idle"));
  });

  // A working fleet still outranks a quiet daemon — the resting floor holds.
  it("never dims below the resting energy for a silent daemon", () => {
    expect(
      displayOrbState(view(), activityEnergy("working"), false, daemonLeg("listening")).energy,
    ).toBe(activityEnergy("working"));
  });
});

// The mirrored orb: the app window's room announced a phase and nothing else —
// there is no session view here and no player to hear, so the phase alone
// drives all three dials.
describe("mirroredOrbState", () => {
  it("lights the dials off the mirrored phase alone", () => {
    expect(mirroredOrbState("speaking", activityEnergy("idle"))).toEqual({
      energy: 0.95,
      listening: true,
      speaking: true,
    });
    // The room listens THROUGH its own reply — thinking keeps the mic open.
    expect(mirroredOrbState("thinking", activityEnergy("idle"))).toEqual({
      energy: 0.7,
      listening: true,
      speaking: false,
    });
    expect(mirroredOrbState("listening", activityEnergy("idle"))).toEqual({
      energy: activityEnergy("idle"),
      listening: true,
      speaking: false,
    });
  });

  it("goes quiet for the two silent phases, and never dims below its resting floor", () => {
    expect(mirroredOrbState("idle", activityEnergy("idle"))).toEqual({
      energy: activityEnergy("idle"),
      listening: false,
      speaking: false,
    });
    expect(mirroredOrbState("muted", activityEnergy("idle")).listening).toBe(false);
    expect(mirroredOrbState("muted", activityEnergy("working")).energy).toBe(
      activityEnergy("working"),
    );
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
