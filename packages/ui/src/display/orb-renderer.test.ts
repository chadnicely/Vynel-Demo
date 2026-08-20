import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrbRenderer } from "./orb-renderer.js";

interface RecordedGradient {
  stops: Array<[number, string]>;
  addColorStop(offset: number, color: string): void;
}

/** A 2D context that records what the frame loop asked it to paint. */
function createContextRecorder() {
  const gradients: RecordedGradient[] = [];
  const calls = {
    moveTo: 0,
    arc: 0,
    stroke: 0,
    ellipse: 0,
    drawImage: 0,
    clearRect: 0,
  };
  /** The width each stroke was painted at, in order — waves first, then dials. */
  const strokeWidths: number[] = [];
  const context = {
    canvas: null as unknown,
    lineWidth: 0,
    lineCap: "butt",
    shadowColor: "",
    shadowBlur: 0,
    strokeStyle: "",
    fillStyle: "" as unknown,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    fill: () => {},
    fillRect: () => {},
    clearRect: () => {
      calls.clearRect++;
    },
    moveTo: () => {
      calls.moveTo++;
    },
    arc: () => {
      calls.arc++;
    },
    ellipse: () => {
      calls.ellipse++;
    },
    stroke: () => {
      calls.stroke++;
      strokeWidths.push(context.lineWidth);
    },
    drawImage: () => {
      calls.drawImage++;
    },
    createRadialGradient: () => {
      const gradient: RecordedGradient = {
        stops: [],
        addColorStop(offset, color) {
          this.stops.push([offset, color]);
        },
      };
      gradients.push(gradient);
      return gradient;
    },
  };
  return { context, calls, gradients, strokeWidths };
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = 0;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnected++;
  }
}

/** Alpha of a bloom gradient's first stop — `rgba(r,g,b,A)`. */
function firstStopAlpha(gradient: RecordedGradient): number {
  const color = gradient.stops[0]?.[1] ?? "";
  return Number(color.slice(color.lastIndexOf(",") + 1, -1));
}

describe("createOrbRenderer", () => {
  const recorder = { current: createContextRecorder() };
  let pending: Map<number, FrameRequestCallback>;
  let cancelled: number[];
  let nextFrameId: number;
  let canvas: HTMLCanvasElement;

  /** Drives the loop with deterministic timestamps so nothing depends on wall time. */
  function runFrames(count: number, startedAt = 1000): void {
    for (let i = 0; i < count; i++) {
      const entry = [...pending.entries()][0];
      if (!entry) return;
      pending.delete(entry[0]);
      entry[1](startedAt + i * 16);
    }
  }

  beforeEach(() => {
    recorder.current = createContextRecorder();
    pending = new Map();
    cancelled = [];
    nextFrameId = 1;
    FakeResizeObserver.instances = [];

    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      pending.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelled.push(id);
      pending.delete(id);
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => recorder.current.context as unknown as CanvasRenderingContext2D,
    );

    canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(canvas, "clientHeight", {
      value: 300,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws when the canvas has no 2D context", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    expect(() => createOrbRenderer(canvas)).toThrow(/2D context unavailable/);
  });

  it("sizes from the observed box and caps the device pixel ratio at 2", () => {
    vi.stubGlobal("devicePixelRatio", 3);

    const renderer = createOrbRenderer(canvas, { moteCount: 4 });

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    renderer.stop();
  });

  it("re-measures when the observer fires instead of reading layout per frame", () => {
    const renderer = createOrbRenderer(canvas, { moteCount: 4 });
    const observer = FakeResizeObserver.instances[0]!;
    expect(observer.observed).toEqual([canvas]);

    Object.defineProperty(canvas, "clientWidth", {
      value: 120,
      configurable: true,
    });
    runFrames(3);
    expect(canvas.width).toBe(400);

    observer.callback();
    expect(canvas.width).toBe(120);
    renderer.stop();
  });

  // Dragging the window to a monitor of a different density changes the ratio
  // without changing the box, so the observer never fires — the orb would keep
  // drawing at the old density until something else resized it.
  it("follows the pixel ratio when the window moves to another monitor", () => {
    const renderer = createOrbRenderer(canvas, { moteCount: 4 });
    expect(canvas.width).toBe(400);

    vi.stubGlobal("devicePixelRatio", 2);
    runFrames(1);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);

    vi.stubGlobal("devicePixelRatio", 1);
    runFrames(1);
    expect(canvas.width).toBe(400);
    renderer.stop();
  });

  it("draws each dial as one batched path — 87 segments, three strokes", () => {
    const renderer = createOrbRenderer(canvas, { moteCount: 4 });

    runFrames(1);

    expect(recorder.current.calls.moveTo).toBe(22 + 5 + 60);
    expect(recorder.current.calls.stroke).toBe(3);
    renderer.stop();
  });

  it("eases energy toward its target and clamps it to 0..1", () => {
    const renderer = createOrbRenderer(canvas, { moteCount: 4 });
    renderer.setEnergy(5);

    runFrames(1);
    const afterOneFrame = firstStopAlpha(recorder.current.gradients.at(-1)!);
    runFrames(200);
    const settled = firstStopAlpha(recorder.current.gradients.at(-1)!);

    // Eased, not cut: one frame moves 4% of the way.
    expect(afterOneFrame).toBeGreaterThan(0.55);
    expect(afterOneFrame).toBeLessThan(0.6);
    // Clamped: an energy of 5 settles exactly where 1 does (0.55 + 0.35).
    expect(settled).toBeCloseTo(0.9, 2);
    renderer.stop();
  });

  it("clamps a negative energy to zero", () => {
    const renderer = createOrbRenderer(canvas, { moteCount: 4 });
    renderer.setEnergy(-3);

    runFrames(200);

    expect(firstStopAlpha(recorder.current.gradients.at(-1)!)).toBeCloseTo(
      0.55,
      2,
    );
    renderer.stop();
  });

  it("brightens while listening and while speaking", () => {
    const quiet = createOrbRenderer(canvas, { moteCount: 4 });
    runFrames(30);
    const idle = firstStopAlpha(recorder.current.gradients.at(-1)!);
    quiet.stop();

    recorder.current = createContextRecorder();
    const listening = createOrbRenderer(canvas, { moteCount: 4 });
    listening.setListening(true);
    runFrames(30);
    const heard = firstStopAlpha(recorder.current.gradients.at(-1)!);
    listening.stop();

    recorder.current = createContextRecorder();
    const speaking = createOrbRenderer(canvas, { moteCount: 4 });
    speaking.setSpeaking(true);
    runFrames(30);
    const spoken = firstStopAlpha(recorder.current.gradients.at(-1)!);
    speaking.stop();

    expect(heard).toBeGreaterThan(idle);
    expect(spoken).toBeGreaterThan(idle);
  });

  it("caps the shockwaves a burst of spikes can stack up", () => {
    const renderer = createOrbRenderer(canvas, { moteCount: 4 });

    for (let i = 0; i < 20; i++) renderer.spike();
    runFrames(1);

    expect(recorder.current.calls.ellipse).toBe(6);
    renderer.stop();
  });

  it("clamps a spike to the strength the demo actually spoke at", () => {
    const overdriven = createOrbRenderer(canvas, { moteCount: 4 });
    overdriven.spike(9);
    runFrames(1);
    const overdrivenWave = recorder.current.strokeWidths[0];
    overdriven.stop();

    recorder.current = createContextRecorder();
    const normal = createOrbRenderer(canvas, { moteCount: 4 });
    normal.spike(1);
    runFrames(1);

    expect(overdrivenWave).toBe(recorder.current.strokeWidths[0]);
    normal.stop();
  });

  it("stops the loop, releases the observer, and stays inert afterwards", () => {
    const renderer = createOrbRenderer(canvas, { moteCount: 4 });
    const observer = FakeResizeObserver.instances[0]!;
    runFrames(1);
    const inFlight = [...pending.values()][0]!;
    const framesBefore = nextFrameId;

    renderer.stop();
    renderer.stop();

    expect(cancelled).toHaveLength(1);
    expect(observer.disconnected).toBe(1);
    expect(pending.size).toBe(0);

    // The frame that was already queued must neither paint nor reschedule.
    inFlight(2000);
    // The setters can only be shown to be harmless — with the loop stopped
    // there is no frame left to observe them through.
    renderer.setEnergy(1);
    renderer.setListening(true);
    renderer.setSpeaking(true);
    renderer.spike();
    runFrames(5);
    expect(nextFrameId).toBe(framesBefore);
  });
});
