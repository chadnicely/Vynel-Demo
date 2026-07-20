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
  if (view.state === "speaking") return view.spokenText;
  return "Say “Hey Vynel” — or tap the mic to talk";
}
