import { describe, expect, it } from "vitest";
import { formatDayLabel, localDayKey } from "./format-day-label.js";

// A fixed local "now" so the relative labels are deterministic.
const NOW = new Date(2026, 6, 23, 14, 30); // Thu Jul 23 2026, local time

describe("localDayKey", () => {
  it("formats a local date as YYYY-MM-DD with zero padding", () => {
    expect(localDayKey(NOW)).toBe("2026-07-23");
    expect(localDayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("formatDayLabel", () => {
  it("labels the adjacent days relative to now", () => {
    expect(formatDayLabel("2026-07-23", NOW)).toBe("Today");
    expect(formatDayLabel("2026-07-24", NOW)).toBe("Tomorrow");
    expect(formatDayLabel("2026-07-22", NOW)).toBe("Yesterday");
  });

  it("crosses month boundaries correctly", () => {
    const endOfMonth = new Date(2026, 6, 31, 9, 0); // Jul 31
    expect(formatDayLabel("2026-08-01", endOfMonth)).toBe("Tomorrow");
    const startOfMonth = new Date(2026, 7, 1, 9, 0); // Aug 1
    expect(formatDayLabel("2026-07-31", startOfMonth)).toBe("Yesterday");
  });

  it("crosses the year boundary and adds the year on off-year dates", () => {
    const newYearsEve = new Date(2026, 11, 31, 23, 0); // Dec 31 2026
    expect(formatDayLabel("2027-01-01", newYearsEve)).toBe("Tomorrow");
    // A same-year day: weekday + month + day, no year.
    expect(formatDayLabel("2026-07-20", NOW)).toBe("Mon, Jul 20");
    // An off-year day carries its year.
    expect(formatDayLabel("2025-12-31", NOW)).toBe("Wed, Dec 31, 2025");
  });

  it("falls back to the raw string on an invalid day key", () => {
    expect(formatDayLabel("not-a-date", NOW)).toBe("not-a-date");
    expect(formatDayLabel("", NOW)).toBe("");
  });
});
