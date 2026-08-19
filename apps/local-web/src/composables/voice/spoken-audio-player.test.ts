import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSentencePipeline,
  createSpokenAudioPlayer,
  toSpokenSentences,
  type SentencePipelineIo,
} from "./spoken-audio-player.js";

// The pipeline is the latency win: sentence N+1 must be FETCHING while N plays
// — across `play()` calls too, since a streamed reply arrives one sentence per
// call (voice-realtime) — and order/cancel/failure behavior must hold. Tested
// pure with fakes; the fetch/Audio wiring stays thin around it.

afterEach(() => {
  vi.unstubAllGlobals();
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A scripted pipeline: fetches resolve at once (or null for `failing`),
 *  playback holds until the test releases it. */
function makeFakeIo(options: { failing?: string[]; holdPlayback?: boolean } = {}) {
  const log: string[] = [];
  const releases: Array<() => void> = [];
  let stopped = 0;
  const io: SentencePipelineIo<string> = {
    fetchWav: (text) => {
      log.push(`fetch:${text}`);
      return Promise.resolve(options.failing?.includes(text) ? null : text);
    },
    playWav: (wav) => {
      log.push(`play:${wav}`);
      if (!options.holdPlayback) return Promise.resolve();
      const gate = deferred<void>();
      releases.push(gate.resolve);
      return gate.promise;
    },
    stopPlayback: () => {
      stopped += 1;
      releases.splice(0).forEach((release) => release());
    },
  };
  return {
    io,
    log,
    releaseCurrent: () => releases.shift()?.(),
    stoppedCount: () => stopped,
  };
}

describe("toSpokenSentences", () => {
  it("splits at sentence boundaries and keeps a trailing fragment", () => {
    expect(toSpokenSentences("First one. Second one! And a tail")).toEqual([
      "First one.",
      "Second one!",
      "And a tail",
    ]);
  });

  it("returns nothing for whitespace", () => {
    expect(toSpokenSentences("   ")).toEqual([]);
  });
});

describe("createSentencePipeline", () => {
  it("prefetches the next sentence while the current one plays", async () => {
    const fake = makeFakeIo({ holdPlayback: true });
    const pipeline = createSentencePipeline(fake.io);
    const done = pipeline.enqueue(["one.", "two."]);
    await flush();
    // Sentence two was fetched BEFORE sentence one finished playing.
    expect(fake.log).toEqual(["fetch:one.", "fetch:two.", "play:one."]);
    fake.releaseCurrent();
    await flush();
    expect(fake.log).toEqual(["fetch:one.", "fetch:two.", "play:one.", "play:two."]);
    fake.releaseCurrent();
    await done;
  });

  it("pipelines ACROSS enqueue calls — a sentence queued mid-playback is synthesized before the current one ends", async () => {
    const fake = makeFakeIo({ holdPlayback: true });
    const pipeline = createSentencePipeline(fake.io);
    const first = pipeline.enqueue(["one."]);
    await flush();
    expect(fake.log).toEqual(["fetch:one.", "play:one."]);
    // The next streamed sentence arrives while "one." is still playing.
    const second = pipeline.enqueue(["two."]);
    await flush();
    expect(fake.log).toEqual(["fetch:one.", "play:one.", "fetch:two."]);
    fake.releaseCurrent();
    await first;
    await flush();
    expect(fake.log.at(-1)).toBe("play:two.");
    fake.releaseCurrent();
    await second;
  });

  it("skips a sentence whose fetch failed and keeps going", async () => {
    const fake = makeFakeIo({ failing: ["two."] });
    const pipeline = createSentencePipeline(fake.io);
    await pipeline.enqueue(["one.", "two.", "three."]);
    expect(fake.log.filter((entry) => entry.startsWith("play:"))).toEqual([
      "play:one.",
      "play:three.",
    ]);
  });

  it("cancel cuts the playing sentence, drops the queue, settles every caller — and the next enqueue plays", async () => {
    const fake = makeFakeIo({ holdPlayback: true });
    const pipeline = createSentencePipeline(fake.io);
    const done = pipeline.enqueue(["one.", "two.", "three."]);
    await flush();
    expect(fake.log).toEqual(["fetch:one.", "fetch:two.", "play:one."]);
    pipeline.cancel();
    await expect(done).resolves.toBeUndefined(); // the barge-in never wedges the caller
    expect(fake.stoppedCount()).toBe(1);
    await flush();
    // Nothing queued before the cancel ever plays.
    expect(fake.log.filter((entry) => entry.startsWith("play:"))).toEqual(["play:one."]);

    const after = pipeline.enqueue(["four."]);
    await flush();
    expect(fake.log.at(-1)).toBe("play:four.");
    fake.releaseCurrent();
    await after;
  });

  it("resolves immediately for an empty list", async () => {
    const fake = makeFakeIo();
    await expect(createSentencePipeline(fake.io).enqueue([])).resolves.toBeUndefined();
    expect(fake.log).toEqual([]);
  });
});

describe("createSpokenAudioPlayer", () => {
  it("cancel mid-playback settles play() — the session loop must never wedge", async () => {
    // pause() fires neither onended nor onerror, so without cancel() resolving
    // the in-flight playback, play() would hang forever and with it the awaiting
    // session loop (done never settles → /session/end never posts → deaf daemon).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["wav"])) }),
    );
    class HangingAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public src: string) {}
      play(): Promise<void> {
        return Promise.resolve(); // starts "playing" and never ends on its own
      }
      pause(): void {}
    }
    vi.stubGlobal("Audio", HangingAudio);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });

    const player = createSpokenAudioPlayer();
    const done = player.play("One sentence.");
    await flush(); // reach playback
    player.cancel();
    await expect(done).resolves.toBeUndefined();
  });

  it("synthesizes through the daemon proxy once per sentence and stays silent when it is down", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const player = createSpokenAudioPlayer();
    await player.play("First one. Second one.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).text)).toEqual([
      "First one.",
      "Second one.",
    ]);
  });
});
