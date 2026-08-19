import { describe, expect, it } from "vitest";
import {
  voiceStageCaption,
  voiceStageIsListening,
  voiceStageOrbState,
} from "./voice-stage-view.js";
import type { VoiceCommandSessionView } from "../../composables/voice/voice-command-session-types.js";

function view(partial: Partial<VoiceCommandSessionView>): VoiceCommandSessionView {
  return { state: "ended", transcript: "", spokenText: "", notice: "", ...partial };
}

describe("voiceStageCaption", () => {
  it("shows the live transcript while listening, with a placeholder before speech", () => {
    expect(voiceStageCaption(view({ state: "listening", transcript: "what time" }), false, null)).toBe(
      "what time",
    );
    expect(voiceStageCaption(view({ state: "listening" }), false, null)).toBe("Listening…");
  });

  it("shows Thinking… while the turn is in flight (not the stale command)", () => {
    expect(
      voiceStageCaption(view({ state: "thinking", transcript: "what time is it" }), false, null),
    ).toBe("Thinking…");
  });

  it("shows the honesty line the silent turn spoke, while the orb stays thinking", () => {
    const notice = "Still working on it — I'll say the answer when it lands.";
    const stillThinking = view({ state: "thinking", transcript: "do a long thing", notice });
    expect(voiceStageCaption(stillThinking, false, null)).toBe(notice);
    expect(voiceStageOrbState(stillThinking, false)).toBe("thinking");
  });

  it("shows the spoken reply so far while speaking", () => {
    expect(
      voiceStageCaption(view({ state: "speaking", spokenText: "It is two. Go to bed." }), false, null),
    ).toBe("It is two. Go to bed.");
  });

  it("failure and mute outrank session state", () => {
    expect(voiceStageCaption(view({ state: "listening" }), false, "mic denied")).toBe("mic denied");
    expect(voiceStageCaption(view({ state: "listening" }), true, null)).toContain("Muted");
  });
});

describe("voiceStageOrbState", () => {
  it("maps ended to idle and mute over everything", () => {
    expect(voiceStageOrbState(view({ state: "ended" }), false)).toBe("idle");
    expect(voiceStageOrbState(view({ state: "thinking" }), false)).toBe("thinking");
    expect(voiceStageOrbState(view({ state: "thinking" }), true)).toBe("muted");
  });
});

describe("voiceStageIsListening", () => {
  it("is on through the whole live session — speaking and thinking included — and off when muted or ended", () => {
    expect(voiceStageIsListening(view({ state: "listening" }), false)).toBe(true);
    expect(voiceStageIsListening(view({ state: "thinking" }), false)).toBe(true);
    expect(voiceStageIsListening(view({ state: "speaking", spokenText: "Hi." }), false)).toBe(true);
    expect(voiceStageIsListening(view({ state: "speaking", spokenText: "Hi." }), true)).toBe(false);
    expect(voiceStageIsListening(view({ state: "ended" }), false)).toBe(false);
  });
});
