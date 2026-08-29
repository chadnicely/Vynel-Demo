import { describe, expect, it, vi } from "vitest";
import { createSpeakerTestWav, playSpeakerTest } from "./speaker-test-tone.js";

describe("createSpeakerTestWav", () => {
  it("is a playable WAV, not an empty blob", async () => {
    const wav = createSpeakerTestWav();
    const header = new Uint8Array(await wav.arrayBuffer());
    const ascii = (from: number, to: number) =>
      String.fromCharCode(...header.slice(from, to));

    expect(wav.type).toBe("audio/wav");
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 12)).toBe("WAVE");
    // 44-byte header + 0.6s of 16-bit mono at 44.1kHz.
    expect(header.length).toBe(44 + Math.floor(44_100 * 0.6) * 2);
  });

  it("carries actual sound — a silent test would prove nothing", async () => {
    const buffer = await createSpeakerTestWav().arrayBuffer();
    const view = new DataView(buffer);
    let loudest = 0;
    for (let offset = 44; offset < buffer.byteLength; offset += 2) {
      loudest = Math.max(loudest, Math.abs(view.getInt16(offset, true)));
    }
    expect(loudest).toBeGreaterThan(1000);
  });
});

describe("playSpeakerTest", () => {
  function fakeAudio(overrides: Record<string, unknown> = {}) {
    const played = { setSinkIdCalledWith: null as string | null, playCalls: 0 };
    vi.stubGlobal(
      "Audio",
      class {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        setSinkId = async (id: string) => {
          played.setSinkIdCalledWith = id;
        };
        play = async () => {
          played.playCalls += 1;
          queueMicrotask(() => this.onended?.());
        };
        constructor() {
          Object.assign(this, overrides);
        }
      },
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
    return played;
  }

  it("routes to the chosen speaker", async () => {
    const played = fakeAudio();
    await playSpeakerTest("spk-1");
    expect(played.setSinkIdCalledWith).toBe("spk-1");
    expect(played.playCalls).toBe(1);
  });

  it("plays on the default speaker when nothing is picked", async () => {
    const played = fakeAudio();
    await playSpeakerTest(undefined);
    expect(played.setSinkIdCalledWith).toBeNull();
    expect(played.playCalls).toBe(1);
  });

  it("resolves rather than hanging when playback refuses", async () => {
    fakeAudio({
      play: async () => {
        throw new Error("NotAllowedError");
      },
    });
    await expect(playSpeakerTest(undefined)).resolves.toBeUndefined();
  });

  it("survives a browser with no setSinkId — the default speaker still plays", async () => {
    const played = fakeAudio({ setSinkId: undefined });
    await playSpeakerTest("spk-1");
    expect(played.setSinkIdCalledWith).toBeNull();
    expect(played.playCalls).toBe(1);
  });
});
