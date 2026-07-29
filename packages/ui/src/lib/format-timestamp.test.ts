import { describe, expect, it } from "vitest";
import { formatElapsed, formatMessageTimestamp } from "./format-timestamp.js";

describe("formatMessageTimestamp", () => {
  const now = new Date("2026-07-28T20:00:00");

  it("shows time alone for a same-day message", () => {
    expect(formatMessageTimestamp("2026-07-28T11:49:00", now)).toMatch(
      /11:49/,
    );
    expect(formatMessageTimestamp("2026-07-28T11:49:00", now)).not.toContain(
      "Jul",
    );
  });

  it("adds the day once it isn't today", () => {
    const label = formatMessageTimestamp("2026-07-27T03:15:00", now);
    expect(label).toContain("Jul 27");
    expect(label).toContain("·");
    expect(label).toMatch(/3:15|03:15/);
  });

  it("adds the year across the year boundary", () => {
    expect(formatMessageTimestamp("2025-12-31T09:00:00", now)).toContain(
      "2025",
    );
  });

  it("returns empty for an unparseable stamp", () => {
    expect(formatMessageTimestamp("not-a-date", now)).toBe("");
  });
});

describe("formatElapsed", () => {
  const t0 = Date.parse("2026-07-28T12:00:00Z");

  it("counts seconds under a minute", () => {
    expect(formatElapsed(t0, t0 + 4_000)).toBe("4s");
    expect(formatElapsed(t0, t0 + 59_999)).toBe("59s");
  });

  it("switches to m ss past a minute, zero-padding seconds", () => {
    expect(formatElapsed(t0, t0 + 72_000)).toBe("1m 12s");
    expect(formatElapsed(t0, t0 + 60_000)).toBe("1m 00s");
  });

  it("switches to h mm past an hour", () => {
    expect(formatElapsed(t0, t0 + 3_780_000)).toBe("1h 03m");
  });

  it("clamps a clock skew below zero to 0s", () => {
    expect(formatElapsed(t0, t0 - 5_000)).toBe("0s");
  });
});
