import { describe, expect, it } from "vitest";
import {
  createVoiceLatencyTracer,
  type VoiceLatencyTraceReport,
} from "./voice-latency-trace.js";

/** A tracer over a hand-cranked clock and a captured post. */
function harness(startWall = "2026-08-27T12:00:00.000Z") {
  let now = 1000;
  const posted: VoiceLatencyTraceReport[] = [];
  const tracer = createVoiceLatencyTracer({
    now: () => now,
    wallClock: () => startWall,
    post: (report) => posted.push(report),
  });
  return { tracer, posted, tick: (ms: number) => (now += ms) };
}

describe("voice latency tracer", () => {
  it("posts one complete trace with per-stage deltas", () => {
    const { tracer, posted, tick } = harness();

    tracer.markSpeechEnd(1500);
    tick(80);
    tracer.markDispatch();
    tick(1200);
    tracer.markFirstToken();
    tick(900);
    tracer.markFirstTts();
    tick(150);
    tracer.markFirstAudible();

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      complete: true,
      endpointSilenceMs: 1500,
      speechEndToDispatchMs: 80,
      dispatchToFirstTokenMs: 1200,
      firstTokenToFirstTtsMs: 900,
      firstTtsToFirstAudibleMs: 150,
      // The number he feels: the whole chain end to end.
      speechEndToFirstAudibleMs: 80 + 1200 + 900 + 150,
    });
    expect(posted[0]!.marks).toEqual({
      speechEnd: 0,
      dispatch: 80,
      firstToken: 1280,
      firstTts: 2180,
      firstAudible: 2330,
    });
  });

  // "First token" fires on EVERY chunk at the call site — only the first may
  // count, or the metric silently becomes "last token".
  it("keeps the first mark when a mark repeats", () => {
    const { tracer, posted, tick } = harness();

    tracer.markSpeechEnd();
    tick(100);
    tracer.markFirstToken();
    tick(400);
    tracer.markFirstToken();
    tick(10);
    tracer.markFirstAudible();

    expect(posted[0]!.marks.firstToken).toBe(100);
  });

  it("posts exactly once per exchange", () => {
    const { tracer, posted } = harness();

    tracer.markSpeechEnd();
    tracer.markFirstAudible();
    tracer.flush("turn-settled");
    tracer.markFirstAudible();

    expect(posted).toHaveLength(1);
  });

  // A turn that never sounded still owes its numbers — that trace IS the
  // evidence when the daemon is down or the reply was empty.
  it("flushes an incomplete trace with its reason", () => {
    const { tracer, posted, tick } = harness();

    tracer.markSpeechEnd(1500);
    tick(90);
    tracer.markDispatch();
    tick(2000);
    tracer.flush("turn-settled-silent");

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      complete: false,
      reason: "turn-settled-silent",
      speechEndToDispatchMs: 90,
    });
    expect(posted[0]!.speechEndToFirstAudibleMs).toBeUndefined();
  });

  // Two utterances never share a stopwatch: a new speech end posts the old
  // trace as superseded rather than folding two exchanges into one number.
  it("supersedes an unposted trace when the next utterance lands", () => {
    const { tracer, posted, tick } = harness();

    tracer.markSpeechEnd();
    tick(50);
    tracer.markDispatch();
    tick(10);
    tracer.markSpeechEnd();
    tracer.markFirstAudible();

    expect(posted).toHaveLength(2);
    expect(posted[0]).toMatchObject({ complete: false, reason: "superseded" });
    expect(posted[1]!.marks.speechEnd).toBe(0);
  });

  // The player is shared with surfaces that speak OUTSIDE a voice exchange
  // (relayed lines on the idle room) — their marks must not open ghost traces.
  it("ignores stream and audio marks with no open trace", () => {
    const { tracer, posted } = harness();

    tracer.markFirstToken();
    tracer.markFirstTts();
    tracer.markFirstAudible();
    tracer.flush("session-ended");

    expect(posted).toHaveLength(0);
  });

  // An external line can reach the session without a captured utterance — the
  // dispatch itself opens the trace so those turns still measure.
  it("opens on dispatch when speech end never fired", () => {
    const { tracer, posted, tick } = harness();

    tracer.markDispatch();
    tick(700);
    tracer.markFirstAudible();

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ complete: false });
    expect(posted[0]!.marks).toMatchObject({ dispatch: 0, firstAudible: 700 });
    expect(posted[0]!.speechEndToFirstAudibleMs).toBeUndefined();
  });
});
