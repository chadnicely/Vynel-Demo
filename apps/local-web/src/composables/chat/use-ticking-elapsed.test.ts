// Tests for the shared elapsed clock — the interval lifecycle IS the
// extraction's point: starts when already running, freezes on stop, reseeds
// on restart, dies with the scope.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { useTickingElapsed } from "./use-ticking-elapsed.js";

describe("useTickingElapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks while running and freezes when the run stops", async () => {
    const scope = effectScope();
    const isRunning = ref(true);
    const startedAtMs = Date.now() - 5_000;
    const elapsed = scope.run(() =>
      useTickingElapsed(() => startedAtMs, isRunning),
    )!;

    expect(elapsed.value).toBe("5s");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(elapsed.value).toBe("8s");

    isRunning.value = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(elapsed.value).toBe("8s");
    scope.stop();
  });

  it("reseeds the clock when a new run starts", async () => {
    const scope = effectScope();
    const isRunning = ref(false);
    const startedAtMs = ref<number | null>(null);
    const elapsed = scope.run(() =>
      useTickingElapsed(startedAtMs, isRunning),
    )!;

    expect(elapsed.value).toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);
    startedAtMs.value = Date.now() - 2_000;
    isRunning.value = true;
    await vi.advanceTimersByTimeAsync(0);
    // A fresh run must not show the stale pre-run now — 2s, not a minute.
    expect(elapsed.value).toBe("2s");
    scope.stop();
  });

  it("stops ticking when the owning scope dies", async () => {
    const scope = effectScope();
    const elapsed = scope.run(() =>
      useTickingElapsed(() => Date.now() - 1_000, () => true),
    )!;
    expect(elapsed.value).toBe("1s");

    scope.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    // Frozen at the last pre-dispose tick — the interval is gone.
    expect(elapsed.value).toBe("1s");
  });
});
