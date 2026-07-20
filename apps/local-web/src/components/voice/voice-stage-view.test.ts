import { describe, expect, it } from "vitest";
import { voiceStageCaption, voiceStageOrbState } from "./voice-stage-view.js";
import type { VoiceCommandSessionView } from "../../composables/voice/voice-command-session.js";

function view(partial: Partial<VoiceCommandSessionView>): VoiceCommandSessionView {
  return { state: "ended", transcript: "", spokenText: "", ...partial };
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

  it("shows the spoken words while speaking", () => {
    expect(
      voiceStageCaption(view({ state: "speaking", spokenText: "It is two." }), false, null),
    ).toBe("It is two.");
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
