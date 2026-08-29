import { beforeEach, describe, expect, it } from "vitest";
import { readDemoArmedFlag, writeDemoArmedFlag } from "./demo-armed-flag.js";

const KEY = "vynel.demo-mode-armed-at";

beforeEach(() => localStorage.clear());

describe("demo-armed-flag", () => {
  it("round-trips arm and disarm", () => {
    expect(readDemoArmedFlag()).toBe(false);
    writeDemoArmedFlag(true);
    expect(readDemoArmedFlag()).toBe(true);
    writeDemoArmedFlag(false);
    expect(readDemoArmedFlag()).toBe(false);
  });

  it("expires on its own — an armed flag left from film day never swallows next week's wakes", () => {
    localStorage.setItem(KEY, String(Date.now() - 7 * 60 * 60 * 1000));
    expect(readDemoArmedFlag()).toBe(false);
    // Expiry also CLEANS UP, so the stale value cannot be re-read.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("fails closed on garbage", () => {
    localStorage.setItem(KEY, "not-a-time");
    expect(readDemoArmedFlag()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
