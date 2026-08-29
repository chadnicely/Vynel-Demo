import { describe, expect, it, beforeEach } from "vitest";
import {
  cacheKeyFor,
  clearCachedLines,
  readCachedLines,
  writeCachedLine,
} from "./demo-audio-cache.js";

// The cache is what keeps a recorded reel across a reload — without it a
// refresh emptied "Ready to film" and Approve re-recorded minutes of audio.
//
// The round-trip needs a real IndexedDB, which jsdom has not got. So the KEY
// rule — the part that decides whether a take can end up half in one voice and
// half in another — is tested directly, and the storage tests declare
// themselves skipped rather than passing vacuously against a missing API.

const hasIndexedDb = typeof indexedDB !== "undefined";
const wav = (bytes = 8): Blob => new Blob([new Uint8Array(bytes)], { type: "audio/wav" });

describe("the cache key", () => {
  it("separates the same words spoken in different voices", () => {
    expect(cacheKeyFor("local|kokoro|0|", "Good evening.")).not.toBe(
      cacheKeyFor("local|piper-lessac|0|", "Good evening."),
    );
  });

  it("is stable for the same voice and words", () => {
    expect(cacheKeyFor("v", "line")).toBe(cacheKeyFor("v", "line"));
  });

  it("cannot be confused by a voice name that looks like a line", () => {
    // Without a separator, ("a", "b|c") and ("a|b", "c") would collide and one
    // line would be served as another.
    expect(cacheKeyFor("a", "b|c")).not.toBe(cacheKeyFor("a|b", "c"));
  });
});

describe.skipIf(!hasIndexedDb)("the recorded-line cache (needs IndexedDB)", () => {
  beforeEach(async () => {
    await clearCachedLines();
  });

  it("gives a line back after it was written", async () => {
    await writeCachedLine("local|kokoro|0|", "Good evening.", { wav: wav(), seconds: 1.5 });

    const found = await readCachedLines("local|kokoro|0|", ["Good evening."]);

    expect(found.get("Good evening.")?.seconds).toBe(1.5);
  });

  it("keys on the VOICE — the same words in another voice is a miss", async () => {
    await writeCachedLine("local|kokoro|0|", "Good evening.", { wav: wav(), seconds: 1.5 });

    expect((await readCachedLines("local|piper-lessac|0|", ["Good evening."])).size).toBe(0);
  });

  it("returns only the lines asked for", async () => {
    await writeCachedLine("v", "one", { wav: wav(), seconds: 1 });
    await writeCachedLine("v", "two", { wav: wav(), seconds: 2 });

    expect([...(await readCachedLines("v", ["two"])).keys()]).toEqual(["two"]);
  });
});

describe("without IndexedDB", () => {
  it.skipIf(hasIndexedDb)("reads as a miss rather than throwing", async () => {
    // Private browsing and blocked storage land here; recording must still work,
    // it just re-records after a reload.
    await expect(readCachedLines("v", ["one"])).resolves.toEqual(new Map());
    await expect(
      writeCachedLine("v", "one", { wav: wav(), seconds: 1 }),
    ).resolves.toBeUndefined();
  });
});
