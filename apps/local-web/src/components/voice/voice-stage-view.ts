import type { VoiceOrbState } from "@vynel/ui";
import type { VoiceCommandSessionView } from "../../composables/voice/voice-command-session.js";

// The one mapping from a voice session's view to what the stage shows — shared
// by the in-app overlay and the floating Jarvis window so their orb and caption
// can never drift apart.

export function voiceStageOrbState(
  view: VoiceCommandSessionView,
  isMuted: boolean,
): VoiceOrbState {
  if (isMuted) return "muted";
  return view.state === "ended" ? "idle" : view.state;
}

/** The mic is open — in every live phase, not just while idle-listening: the
 *  session listens THROUGH its own reply (voice-realtime VR2), so the stage
 *  shows "listening" beside a thinking or speaking orb. */
export function voiceStageIsListening(
  view: VoiceCommandSessionView,
  isMuted: boolean,
): boolean {
  return !isMuted && view.state !== "ended";
}

export function voiceStageCaption(
  view: VoiceCommandSessionView,
  isMuted: boolean,
  failure: string | null,
): string {
  if (failure) return failure;
  if (isMuted) return "Muted — Vynel isn't listening";
  if (view.state === "listening") return view.transcript || "Listening…";
  // The command was on screen while it was spoken; once it's sent the user
  // needs to see the turn is IN FLIGHT, not a frozen echo of their own words.
  if (view.state === "thinking") return "Thinking…";
  // The reply so far — it grows a sentence at a time as the speech does.
  if (view.state === "speaking") return view.spokenText;
  return "Say “Hey Vynel” — or tap the mic to talk";
}
