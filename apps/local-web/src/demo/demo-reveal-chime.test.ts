import { describe, expect, it, vi } from "vitest";
import { playRevealChime, REVEAL_MS } from "./demo-reveal-chime.js";

describe("playRevealChime", () => {
  it("is silent where the machine has no audio at all", () => {
    // A room with no sound must never be a room that fails to open.
    const original = Reflect.get(globalThis, "AudioContext");
    Reflect.deleteProperty(globalThis, "AudioContext");
    expect(() => playRevealChime()).not.toThrow();
    if (original !== undefined) Reflect.set(globalThis, "AudioContext", original);
  });

  it("survives a browser that refuses to open an audio context", () => {
    const original = Reflect.get(globalThis, "AudioContext");
    Reflect.set(
      globalThis,
      "AudioContext",
      class {
        constructor() {
          throw new Error("blocked until a user gesture");
        }
      },
    );
    expect(() => playRevealChime()).not.toThrow();
    if (original === undefined) Reflect.deleteProperty(globalThis, "AudioContext");
    else Reflect.set(globalThis, "AudioContext", original);
  });

  it("ends before the assistant speaks", () => {
    // The reveal introduces the voice; it must never talk over it. The opening
    // reply runs ~1.5s, so the gesture has to be well inside that.
    expect(REVEAL_MS).toBeLessThan(1200);
  });
});
