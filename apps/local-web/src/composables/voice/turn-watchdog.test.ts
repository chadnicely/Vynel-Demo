import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnWatchdog } from "./turn-watchdog.js";

// The clock alone: fires once at the window, never after a disarm, never when
// the window is off, and never twice for two arms.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createTurnWatchdog", () => {
  it("fires once at the end of the window", () => {
    const onFire = vi.fn();
    const watchdog = createTurnWatchdog({ ms: 1_000, onFire });
    watchdog.arm();
    vi.advanceTimersByTime(999);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("a disarm before the window cancels it; disarming after the fire is a no-op", () => {
    const onFire = vi.fn();
    const watchdog = createTurnWatchdog({ ms: 1_000, onFire });
    watchdog.arm();
    vi.advanceTimersByTime(500);
    watchdog.disarm();
    vi.advanceTimersByTime(5_000);
    expect(onFire).not.toHaveBeenCalled();

    watchdog.arm();
    vi.advanceTimersByTime(1_000);
    expect(onFire).toHaveBeenCalledTimes(1);
    watchdog.disarm();
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("arming twice keeps the first window — one fire, not two", () => {
    const onFire = vi.fn();
    const watchdog = createTurnWatchdog({ ms: 1_000, onFire });
    watchdog.arm();
    vi.advanceTimersByTime(600);
    watchdog.arm();
    vi.advanceTimersByTime(400);
    expect(onFire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("a window of 0 (or less) never arms", () => {
    const onFire = vi.fn();
    createTurnWatchdog({ ms: 0, onFire }).arm();
    createTurnWatchdog({ ms: -5, onFire }).arm();
    vi.advanceTimersByTime(60 * 60_000);
    expect(onFire).not.toHaveBeenCalled();
  });
});
