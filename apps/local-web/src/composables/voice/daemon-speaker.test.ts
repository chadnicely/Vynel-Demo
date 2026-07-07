import { afterEach, describe, expect, it, vi } from "vitest";
import { createDaemonSpeaker } from "./daemon-speaker.js";
import type { SentenceSpeaker } from "./speech-synthesis.js";

// The load-bearing behaviors: the fallback contract (a sentence never goes
// silent because the daemon is down) and the cancel contract (cancelling
// during playback settles speak() — pause() fires no audio event, so a
// stranded await would hang the whole voice session).

class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  currentTime = 0.5; // pretend playback started
  constructor(public url: string) {
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
}

function buildFallback() {
  const spoken: string[] = [];
  let cancels = 0;
  const fallback: SentenceSpeaker = {
    speak: (text) => {
      spoken.push(text);
      return Promise.resolve();
    },
    cancel: () => {
      cancels += 1;
    },
  };
  return { fallback, spoken, cancels: () => cancels };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDaemonSpeaker", () => {
  it("falls back to the injected speaker when the daemon is unreachable", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")));
    const { fallback, spoken } = buildFallback();
    await createDaemonSpeaker(fallback).speak("Hello there.");
    expect(spoken).toEqual(["Hello there."]);
  });

  it("falls back on a non-OK synthesize response", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("{}", { status: 500 })),
    );
    const { fallback, spoken } = buildFallback();
    await createDaemonSpeaker(fallback).speak("Second try.");
    expect(spoken).toEqual(["Second try."]);
  });

  it("cancel() during playback settles speak() without falling back", async () => {
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
    const { fallback, spoken, cancels } = buildFallback();
    const speaker = createDaemonSpeaker(fallback);

    const speaking = speaker.speak("Cut me off.");
    // Let the fetch/blob microtasks run so playback is in flight.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(FakeAudio.instances).toHaveLength(1);

    speaker.cancel();
    await speaking; // must settle — a hang here strands the whole session
    expect(spoken).toEqual([]);
    expect(cancels()).toBe(1);
  });

  it("falls back when the blob fails before any audio played", async () => {
    FakeAudio.instances = [];
    class UnplayableAudio extends FakeAudio {
      override currentTime = 0;
      override play(): Promise<void> {
        return Promise.reject(new Error("no supported source"));
      }
    }
    vi.stubGlobal("Audio", UnplayableAudio);
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(new Uint8Array([9]), { status: 200 })),
    );
    const { fallback, spoken } = buildFallback();
    await createDaemonSpeaker(fallback).speak("Still heard.");
    expect(spoken).toEqual(["Still heard."]);
  });

  it("cancel() stops the pending fetch and does not fall back afterwards", async () => {
    let rejectFetch!: (reason: Error) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );
    const { fallback, spoken, cancels } = buildFallback();
    const speaker = createDaemonSpeaker(fallback);
    const speaking = speaker.speak("Never heard.");
    speaker.cancel();
    rejectFetch(new Error("aborted"));
    await speaking;
    expect(spoken).toEqual([]); // cancelled — no fallback speech either
    expect(cancels()).toBe(1);
  });
});
