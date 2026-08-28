// The voice turn's stopwatch (voice-latency Phase 1, Kafi 2026-08-27).
//
// One trace per spoken exchange, five marks along its critical path:
//
//   speechEnd    the endpoint timer fired — the moment we DECIDED he was done
//   dispatch     the turn left for the engine
//   firstToken   the first streamed text-chunk arrived from the model
//   firstTts     the first sentence's WAV finished synthesizing
//   firstAudible the first sentence actually started SOUNDING
//
// The trace posts to the engine (`POST /api/voice/latency-trace`) so the
// numbers land in the server log, never the browser console — Chad reads the
// dev terminal, not devtools. It posts when the first audio starts (a complete
// trace), or with whatever it has when the turn settles without ever sounding
// (`flush`), or when the next utterance supersedes it. Never twice.
//
// Module singleton on purpose: the marks come from five files that share no
// other seam (the recognizer, the session, the stream tap, the player), and
// the machine has ONE microphone and ONE speaker — same reasoning as the
// player's own `sentenceStartObservers`. The core is a factory over injected
// I/O so tests drive a fake clock and read the posted payloads.

/** What lands in the engine log — milliseconds between consecutive marks,
 *  so a slow stage names itself without arithmetic at the terminal. */
export interface VoiceLatencyTraceReport {
  /** Wall-clock time of the trace's first mark, for correlating with other logs. */
  startedAt: string;
  /** Every mark actually hit, as offsets (ms) from the first mark. */
  marks: Partial<Record<VoiceLatencyMark, number>>;
  /** speechEnd → dispatch: transcript finalization + turn setup. */
  speechEndToDispatchMs?: number | undefined;
  /** dispatch → firstToken: the engine + the model starting to answer. */
  dispatchToFirstTokenMs?: number | undefined;
  /** firstToken → firstTts: waiting for a speakable chunk + synthesis. */
  firstTokenToFirstTtsMs?: number | undefined;
  /** firstTts → firstAudible: handing the WAV to the speaker. */
  firstTtsToFirstAudibleMs?: number | undefined;
  /** The number he feels: end of speech → first sound. */
  speechEndToFirstAudibleMs?: number | undefined;
  /** All five marks landed. */
  complete: boolean;
  /** Why an incomplete trace posted (turn settled silent, superseded, ended). */
  reason?: string;
  /** The endpoint-silence setting active for this exchange — the tunable that
   *  dominates the total, recorded so a log line is interpretable on its own. */
  endpointSilenceMs?: number;
}

export type VoiceLatencyMark =
  "speechEnd" | "dispatch" | "firstToken" | "firstTts" | "firstAudible";

const MARK_ORDER: readonly VoiceLatencyMark[] = [
  "speechEnd",
  "dispatch",
  "firstToken",
  "firstTts",
  "firstAudible",
];

export interface VoiceLatencyTracerIo {
  /** Monotonic milliseconds — `performance.now()` in the browser. */
  now(): number;
  /** Wall-clock ISO for the report header. */
  wallClock(): string;
  /** Deliver one report. Fire-and-forget; failures are swallowed by the io. */
  post(report: VoiceLatencyTraceReport): void;
}

export interface VoiceLatencyTracer {
  /** End-of-speech detected. BEGINS a trace; an unposted predecessor posts as
   *  superseded first — two utterances never share a stopwatch. */
  markSpeechEnd(endpointSilenceMs?: number): void;
  /** The turn is leaving for the engine. Opens a trace if none is (a turn can
   *  start without a speech end — e.g. an external line handed to the session). */
  markDispatch(): void;
  /** First streamed model token. No-op unless a trace is open and unmarked. */
  markFirstToken(): void;
  /** First synthesized WAV landed. */
  markFirstTts(): void;
  /** First audio element reported 'playing' — completes and posts the trace. */
  markFirstAudible(): void;
  /** The exchange is over without audio (silent turn, barge-in, session end):
   *  post whatever was marked, once, with the reason. */
  flush(reason: string): void;
}

interface OpenTrace {
  startedWall: string;
  /** Monotonic time of the FIRST mark — every offset is relative to it. */
  origin: number;
  marks: Partial<Record<VoiceLatencyMark, number>>;
  endpointSilenceMs?: number;
}

export function createVoiceLatencyTracer(
  io: VoiceLatencyTracerIo,
): VoiceLatencyTracer {
  let open: OpenTrace | null = null;

  function beginTrace(): OpenTrace {
    return { startedWall: io.wallClock(), origin: io.now(), marks: {} };
  }

  function setMark(trace: OpenTrace, mark: VoiceLatencyMark): void {
    // First one wins: "first token" marked on every chunk must not creep.
    trace.marks[mark] ??= io.now() - trace.origin;
  }

  function between(
    trace: OpenTrace,
    from: VoiceLatencyMark,
    to: VoiceLatencyMark,
  ): number | undefined {
    const a = trace.marks[from];
    const b = trace.marks[to];
    if (a === undefined || b === undefined) return undefined;
    return Math.round(b - a);
  }

  function post(trace: OpenTrace, reason?: string): void {
    const complete = MARK_ORDER.every(
      (mark) => trace.marks[mark] !== undefined,
    );
    const rounded: Partial<Record<VoiceLatencyMark, number>> = {};
    for (const mark of MARK_ORDER) {
      const at = trace.marks[mark];
      if (at !== undefined) rounded[mark] = Math.round(at);
    }
    io.post({
      startedAt: trace.startedWall,
      marks: rounded,
      speechEndToDispatchMs: between(trace, "speechEnd", "dispatch"),
      dispatchToFirstTokenMs: between(trace, "dispatch", "firstToken"),
      firstTokenToFirstTtsMs: between(trace, "firstToken", "firstTts"),
      firstTtsToFirstAudibleMs: between(trace, "firstTts", "firstAudible"),
      speechEndToFirstAudibleMs: between(trace, "speechEnd", "firstAudible"),
      complete,
      ...(reason === undefined ? {} : { reason }),
      ...(trace.endpointSilenceMs === undefined
        ? {}
        : { endpointSilenceMs: trace.endpointSilenceMs }),
    });
  }

  return {
    markSpeechEnd(endpointSilenceMs) {
      if (open !== null) post(open, "superseded");
      open = beginTrace();
      if (endpointSilenceMs !== undefined)
        open.endpointSilenceMs = endpointSilenceMs;
      setMark(open, "speechEnd");
    },
    markDispatch() {
      open ??= beginTrace();
      setMark(open, "dispatch");
    },
    markFirstToken() {
      if (open === null) return;
      setMark(open, "firstToken");
    },
    markFirstTts() {
      if (open === null) return;
      setMark(open, "firstTts");
    },
    markFirstAudible() {
      if (open === null) return;
      setMark(open, "firstAudible");
      post(open);
      open = null;
    },
    flush(reason) {
      if (open === null) return;
      post(open, reason);
      open = null;
    },
  };
}

/** The one tracer the app's five voice files share. Posting is fire-and-forget
 *  and failure-silent: instrumentation must never be able to break the voice. */
export const voiceLatencyTracer: VoiceLatencyTracer = createVoiceLatencyTracer({
  now: () => performance.now(),
  wallClock: () => new Date().toISOString(),
  post: (report) => {
    void fetch("/api/voice/latency-trace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
    }).catch(() => undefined);
  },
});
