import { describe, expect, it } from "vitest";
import { playRevealChime, prepareRevealChime, REVEAL_MS } from "./demo-reveal-chime.js";

// The chime renders offline and plays through an <audio> element — the same
// door the take's recorded lines use — because a live Web Audio context in a
// tab he never clicked stays suspended, and the first build played into it:
// a chime, delivered to nobody ("I didn't hear volume!", 2026-09-01).
describe("playRevealChime", () => {
  it("is silent where the machine cannot render audio at all", () => {
    // jsdom has no OfflineAudioContext, which makes this suite the machine
    // in question: the reveal must still be a reveal, just a silent one.
    expect(() => playRevealChime()).not.toThrow();
    expect(() => prepareRevealChime()).not.toThrow();
  });

  it("survives a renderer that throws", () => {
    const original = Reflect.get(globalThis, "OfflineAudioContext");
    Reflect.set(
      globalThis,
      "OfflineAudioContext",
      class {
        constructor() {
          throw new Error("no audio hardware");
        }
      },
    );
    expect(() => playRevealChime()).not.toThrow();
    if (original === undefined) {
      Reflect.deleteProperty(globalThis, "OfflineAudioContext");
    } else {
      Reflect.set(globalThis, "OfflineAudioContext", original);
    }
  });

  it("ends before the assistant speaks", () => {
    // The reveal introduces the voice; it must never talk over it. The
    // opening reply runs ~1.5s, so the gesture has to be well inside that.
    expect(REVEAL_MS).toBeLessThan(1200);
  });
});
