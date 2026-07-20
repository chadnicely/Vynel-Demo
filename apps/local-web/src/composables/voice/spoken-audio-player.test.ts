import { describe, expect, it } from "vitest";
import {
  playSentencesPipelined,
  toSpokenSentences,
} from "./spoken-audio-player.js";

// The pipeline is the latency win: sentence N+1 must be FETCHING while N plays,
// and order/cancel/failure behavior must hold. Tested pure with fakes — the
// fetch/Audio wiring stays thin around it.

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

describe("playSentencesPipelined", () => {
  it("prefetches the next sentence while the current one plays", async () => {
    const log: string[] = [];
    const playGate = deferred<void>();
    const done = playSentencesPipelined(
      ["one.", "two."],
      (text) => {
        log.push(`fetch:${text}`);
        return Promise.resolve(text);
      },
      async (wav) => {
        log.push(`play:${wav}`);
        if (wav === "one.") await playGate.promise;
      },
      () => false,
    );
    // Let the first fetch resolve and playback begin.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Sentence two was fetched BEFORE sentence one finished playing.
    expect(log).toEqual(["fetch:one.", "fetch:two.", "play:one."]);
    playGate.resolve();
    await done;
    expect(log).toEqual(["fetch:one.", "fetch:two.", "play:one.", "play:two."]);
  });

  it("skips a sentence whose fetch failed and keeps going", async () => {
    const played: string[] = [];
    await playSentencesPipelined(
      ["one.", "two.", "three."],
      (text) => Promise.resolve(text === "two." ? null : text),
      (wav) => {
        played.push(wav);
        return Promise.resolve();
      },
      () => false,
    );
    expect(played).toEqual(["one.", "three."]);
  });

  it("stops between steps once cancelled", async () => {
    const played: string[] = [];
    let cancelled = false;
    await playSentencesPipelined(
      ["one.", "two."],
      (text) => Promise.resolve(text),
      (wav) => {
        played.push(wav);
        cancelled = true; // cancel lands during the first playback
        return Promise.resolve();
      },
      () => cancelled,
    );
    expect(played).toEqual(["one."]);
  });
});
