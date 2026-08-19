// The browser voice-command session's contract — what it consumes (the turn
// events, its I/O deps, its options) and what it exposes (the view the stage
// renders, the session handle). Kept apart from the loop itself, which reads
// as the conversation it drives (voice-command-session.ts).

export type VoiceTurnEvent =
  // The turn's session identity — the interrupt target for a barge-in.
  | { readonly kind: "session"; readonly sessionId: string }
  // One spoken sentence of the reply (streamed text, or a speak-tool relay).
  | { readonly kind: "spoke"; readonly text: string }
  | { readonly kind: "completed" }
  // Stopped from elsewhere mid-reply — a quiet end, not a failure.
  | { readonly kind: "interrupted" }
  | { readonly kind: "failed"; readonly message: string };

export type VoiceCommandSessionState = "listening" | "thinking" | "speaking" | "ended";

export interface VoiceCommandSessionView {
  /** The phase — the mic is open in every one but `ended`. */
  readonly state: VoiceCommandSessionState;
  /** The live interim transcript while the user talks; the command while answering. */
  readonly transcript: string;
  /** The reply spoken so far this turn, growing a sentence at a time. */
  readonly spokenText: string;
  /** A status the turn SPOKE while still silent — the watchdog's honesty line —
   *  for the caption in place of "Thinking…"; never part of the reply. */
  readonly notice: string;
}

export interface VoiceCommandSessionDeps {
  /** One capture — the final transcript, or null on silence/abort. */
  captureCommand(onInterim: (transcript: string) => void): Promise<string | null>;
  /** Cancel an in-flight capture (its promise resolves null). */
  abortCapture(): void;
  /** Run the brain turn; yields the session id, each sentence, and a terminal. */
  runBrainTurn(utterance: string, signal: AbortSignal): AsyncIterable<VoiceTurnEvent>;
  /** Queue one sentence on the browser player (pipelined behind what plays);
   *  resolves when it finished playing — or was cancelled. */
  playSpoken(text: string): Promise<void>;
  /** Cut playback and drop every queued sentence (barge-in, end). */
  cancelSpoken(): void;
  /** Stop the running server turn BY IDENTITY (best-effort). */
  interruptTurn(sessionId: string): Promise<void>;
  onView(view: VoiceCommandSessionView): void;
  /** The reason a turn's stream broke. The session already apologises out loud;
   *  this is the CAUSE, which would otherwise be swallowed. The owner logs it. */
  onTurnError?(error: unknown): void;
}

export interface VoiceCommandSessionOptions {
  /** A command captured in the same breath as the wake phrase — run it first. */
  readonly initialCommand?: string;
  /** Silence (ms) between turns before the session ends. */
  readonly idleTimeoutMs?: number;
  /** How long a turn may stay silent before the honesty line is spoken — the
   *  daemon's knob, carried on the wake event (one home); a manual session has
   *  no wake and takes the default. `<= 0` disables it. */
  readonly turnWatchdogMs?: number;
}

export interface VoiceCommandSession {
  /** Resolves once the session ended (idle silence, `end()`, or a mic failure). */
  readonly done: Promise<void>;
  /** The chat session the turn in flight runs on (null between turns, or before
   *  the stream names it) — a relayed `speak` from THIS id is our own voice. */
  readonly currentSessionId: string | null;
  /** Speak a line from ANOTHER producer (a schedule's `speak`, the typed chat)
   *  through this session while a turn is in flight: its player has the room
   *  and its mic is open, so the line rides the same queue — in order behind
   *  the reply, never over it — and the echo filter remembers it as our voice.
   *  Not a barge-in: the turn keeps streaming and the watchdog stays armed.
   *  Returns false when no turn is in flight (or it was cut) — the caller plays
   *  the line itself then. */
  speakExternal(text: string): boolean;
  end(): void;
}
