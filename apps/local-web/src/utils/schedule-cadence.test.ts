import { describe, expect, it } from "vitest";
import {
  buildCronExpression,
  describeScheduleCadence,
  fireAtFromPreset,
} from "./schedule-cadence.js";

describe("buildCronExpression", () => {
  it("builds a daily cron from a time", () => {
    expect(
      buildCronExpression({ frequency: "daily", time: "09:30" }),
    ).toBe("30 9 * * *");
  });

  it("builds a weekly cron with the weekday", () => {
    expect(
      buildCronExpression({ frequency: "weekly", time: "18:00", weekday: 5 }),
    ).toBe("0 18 * * 5");
  });

  it("builds a monthly cron with the day of month", () => {
    expect(
      buildCronExpression({
        frequency: "monthly",
        time: "08:15",
        dayOfMonth: 28,
      }),
    ).toBe("15 8 28 * *");
  });
});

describe("fireAtFromPreset", () => {
  const now = new Date("2026-07-09T20:00:00.000Z");

  it("offsets the relative presets from now", () => {
    expect(fireAtFromPreset("in-15-minutes", now).getTime()).toBe(
      now.getTime() + 15 * 60_000,
    );
    expect(fireAtFromPreset("in-1-hour", now).getTime()).toBe(
      now.getTime() + 60 * 60_000,
    );
  });

  it("puts tomorrow-morning at 9:00 local, one day ahead", () => {
    const fireAt = fireAtFromPreset("tomorrow-morning", now);
    expect(fireAt.getHours()).toBe(9);
    expect(fireAt.getMinutes()).toBe(0);
    expect(fireAt.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("describeScheduleCadence", () => {
  it("reads the dialog's cron shapes back as words", () => {
    expect(
      describeScheduleCadence({
        scheduleKind: "recurring",
        cronExpression: "30 9 * * *",
      }),
    ).toMatch(/^Daily at 9:30/);
    expect(
      describeScheduleCadence({
        scheduleKind: "recurring",
        cronExpression: "0 18 * * 1",
      }),
    ).toMatch(/^Weekly on Monday at 6:00/);
    expect(
      describeScheduleCadence({
        scheduleKind: "recurring",
        cronExpression: "15 8 3 * *",
      }),
    ).toMatch(/^Monthly on the 3rd at 8:15/);
  });

  it("names a one-time schedule Once", () => {
    expect(
      describeScheduleCadence({
        scheduleKind: "one-time",
        cronExpression: null,
      }),
    ).toBe("Once");
  });

  it("falls back to the raw cron for shapes the dialog can't produce", () => {
    expect(
      describeScheduleCadence({
        scheduleKind: "recurring",
        cronExpression: "*/5 * * * *",
      }),
    ).toBe("Custom (*/5 * * * *)");
  });
});
