import { z } from "zod";
import {
  DISPLAY_SESSION_CAPTION_MAX_LENGTH,
  DISPLAY_SESSION_PHASES,
} from "@vynel/contracts/voice/daemon-events";

// The `speak` tool's wire contract. `text` is SPOKEN aloud, so it must be plain
// spoken-style prose — the description steers the model; the daemon speaks it
// verbatim. Capped so a runaway paragraph can't monopolise the single voice.
// `callId` retargets the line INTO a live call (start_call's handle) instead of
// the local speaker.
export const SpeakRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "text must not be empty")
    .max(2000, "text must be at most 2000 characters"),
  callId: z.string().trim().min(1).optional(),
});

// `spoken: false` is a SUCCESS with a reason — the voice daemon simply wasn't
// reachable, so the caller (the brain) knows to fall back to a text reply rather
// than treating it as a hard error.
export const SpeakResponseSchema = z.object({
  spoken: z.boolean(),
  reason: z.string().optional(),
});

export type SpeakResponse = z.infer<typeof SpeakResponseSchema>;

// The app window's report of whether the in-app Display is on screen right
// now. Not a tool and not a preference — a presence fact one window publishes
// so the display dock (which cannot see the app's screen) knows whether the
// room already owns the orb.
export const DisplayActiveRequestSchema = z.object({
  active: z.boolean(),
});

export const DisplayActiveResponseSchema = z.object({
  /** `false` = no live channel on this engine, so no window heard it. */
  published: z.boolean(),
});

// The other half of the same seam: the conversation the app window's Display
// room is HOLDING, so the display dock can mirror a session that lives in
// another window. `caption` is the last line of it, capped at a sentence or
// two — the mini row shows one line and the room carries the whole reply. The
// cap is the contract's own number, not a second opinion: the producer clamps
// to the same one, so a reply long enough to trip this can never reach here.
export const DisplaySessionRequestSchema = z.object({
  live: z.boolean(),
  phase: z.enum(DISPLAY_SESSION_PHASES),
  caption: z.string().max(DISPLAY_SESSION_CAPTION_MAX_LENGTH),
});

export const DisplaySessionResponseSchema = z.object({
  /** `false` = no live channel on this engine, so no window heard it. */
  published: z.boolean(),
});

// The `stop_listening` tool's answer. `stopped: true` = the stop reached at
// least one place a session could live (the windows' voice channel, or the
// daemon); `false` with a reason = nowhere to deliver it (remote engine with
// no live channel).
export const StopListeningResponseSchema = z.object({
  stopped: z.boolean(),
  reason: z.string().optional(),
});

// ── The call tools' wire contracts (voice-in-calls Part C) ──────────────────

export const CallModeSchema = z.enum(["notetaker", "participant"]);

// The label doubles as the call session's NAME — the 120 cap is the spawned
// session name cap, one limit end to end.
export const StartCallRequestSchema = z.object({
  label: z.string().trim().min(1).max(120),
  mode: CallModeSchema.default("notetaker"),
  /** The user's goal for the call, in their words — primes the call session. */
  goal: z.string().trim().min(1).max(2000).optional(),
  /** Windows driver-path ears scoping: the call app's process id. With it the
   *  call hears that app (+ child processes) only; without it, all system
   *  audio except Vynel's own (echo-free either way). Ignored for two-device
   *  cable pairs, which hear through their capture device. */
  capturePid: z.number().int().positive().optional(),
  /** The conductor-friendly alternative to capturePid: the call app's image
   *  name ("chrome", "Zoom"). The daemon resolves it to the process TREE's
   *  root pid and scopes ears the same way. Windows-only; give one of the two
   *  at most. */
  captureProcessName: z.string().trim().min(1).max(64).optional(),
});

/** The daemon's descriptor shape, validated at this boundary. */
export const CallDescriptorSchema = z.object({
  callId: z.string(),
  label: z.string(),
  mode: CallModeSchema,
  sessionId: z.string().optional(),
  startedAtIso: z.string(),
});

export type CallDescriptorWire = z.infer<typeof CallDescriptorSchema>;

// `started: false` is a SUCCESS with a reason (daemon down, cables missing,
// pair busy) — the speak-response precedent.
export const StartCallResponseSchema = z.object({
  started: z.boolean(),
  callId: z.string().optional(),
  sessionId: z.string().optional(),
  reason: z.string().optional(),
});

export const EndCallResponseSchema = z.object({
  ended: z.boolean(),
  sessionId: z.string().optional(),
  reason: z.string().optional(),
});

export const ListCallsResponseSchema = z.object({
  calls: z.array(CallDescriptorSchema),
});

// One spoken exchange's stopwatch (voice-latency Phase 1). The browser voice
// session measures five points on the speak→reply path and posts them here so
// the numbers land in the SERVER log — Chad reads the dev terminal, never the
// browser console. Marks are ms offsets from the trace's first mark; the
// deltas are precomputed client-side so one log line reads without arithmetic.
// Lenient by design (every field beyond `startedAt`/`complete` optional):
// a partial trace from a turn that never sounded is still evidence.
const TraceMarksSchema = z.object({
  speechEnd: z.number().nonnegative().optional(),
  dispatch: z.number().nonnegative().optional(),
  firstToken: z.number().nonnegative().optional(),
  firstTts: z.number().nonnegative().optional(),
  firstAudible: z.number().nonnegative().optional(),
});

export const VoiceLatencyTraceRequestSchema = z.object({
  startedAt: z.string().trim().min(1).max(64),
  marks: TraceMarksSchema,
  speechEndToDispatchMs: z.number().optional(),
  dispatchToFirstTokenMs: z.number().optional(),
  firstTokenToFirstTtsMs: z.number().optional(),
  firstTtsToFirstAudibleMs: z.number().optional(),
  speechEndToFirstAudibleMs: z.number().optional(),
  complete: z.boolean(),
  reason: z.string().trim().max(100).optional(),
  endpointSilenceMs: z.number().optional(),
});

export const VoiceLatencyTraceResponseSchema = z.object({
  logged: z.boolean(),
});
