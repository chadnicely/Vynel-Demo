import { describe, expect, it, vi, beforeEach } from "vitest";
import { effectScope, ref, nextTick } from "vue";
import { useMicrophoneLevel } from "./use-microphone-level.js";

const stopTrack = vi.fn();

function fakeAudio(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      createAnalyser() {
        return {
          fftSize: 0,
          connect: () => undefined,
          // A steady tone at 0.5 → rms 0.5 → clamped to a full bar.
          getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(0.5),
        };
      }
      createMediaStreamSource() {
        return { connect: () => undefined };
      }
      close() {
        return Promise.resolve();
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
}

const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;

beforeEach(() => stopTrack.mockClear());

describe("useMicrophoneLevel", () => {
  it("reports a level once audio is flowing", async () => {
    fakeAudio(async () => stream);
    const scope = effectScope();
    const meter = scope.run(() => useMicrophoneLevel(ref(undefined)))!;

    await nextTick();
    await nextTick();

    expect(meter.live.value).toBe(true);
    expect(meter.level.value).toBeGreaterThan(0);
    scope.stop();
  });

  it("surfaces a refusal instead of sitting silently at zero", async () => {
    fakeAudio(async () => {
      throw new Error("NotAllowedError");
    });
    const scope = effectScope();
    const meter = scope.run(() => useMicrophoneLevel(ref(undefined)))!;

    await nextTick();
    await nextTick();

    expect(meter.live.value).toBe(false);
    expect(meter.error.value).toContain("permission");
    scope.stop();
  });

  it("releases the microphone when it stops", async () => {
    fakeAudio(async () => stream);
    const scope = effectScope();
    const meter = scope.run(() => useMicrophoneLevel(ref(undefined)))!;
    await nextTick();
    await nextTick();

    meter.stop();

    expect(stopTrack).toHaveBeenCalled();
    expect(meter.level.value).toBe(0);
    scope.stop();
  });
});
