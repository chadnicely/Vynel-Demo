import { onUnmounted, ref, type Ref } from "vue";
import { voiceStageIsListening } from "../../components/voice/voice-stage-view.js";
import { observeSpokenSentenceStart } from "../voice/spoken-audio-player.js";
import type { VoiceCommandSessionView } from "../voice/voice-command-session-types.js";

// What the Display's orb does, in one place. The renderer takes three dials
// (energy, listening, speaking) plus a spike per spoken clause; everything
// below is the mapping from what the room actually knows onto those dials.

/** How busy the whole assistant is — the orb's resting brightness. */
export type DisplayActivity = "working" | "needs-input" | "idle";

export interface DisplayOrbState {
  /** 0..1 — how hard the core burns. */
  readonly energy: number;
  /** The mic is open. */
  readonly listening: boolean;
  /** The browser is playing the reply. */
  readonly speaking: boolean;
}

// Idle still burns: an orb at zero reads as an app that died, and the Display
// is a room you leave open. Needs-input sits between — something waits on you.
const ENERGY_BY_ACTIVITY: Record<DisplayActivity, number> = {
  working: 0.85,
  "needs-input": 0.55,
  idle: 0.22,
};

export function activityEnergy(activity: DisplayActivity): number {
  return ENERGY_BY_ACTIVITY[activity];
}

// A live voice turn lifts the orb over its resting level — the room is doing
// something for YOU right now, whatever the rest of the fleet is up to.
const SPEAKING_ENERGY = 0.95;
const THINKING_ENERGY = 0.7;

function voiceEnergy(view: VoiceCommandSessionView): number {
  if (view.state === "speaking") return SPEAKING_ENERGY;
  if (view.state === "thinking") return THINKING_ENERGY;
  return 0;
}

/** The orb's dials. `restingEnergy` is the fleet's (`activityEnergy`); the
 *  voice session only ever lifts it, never dims it — a quiet mic must not
 *  hide that six sessions are running.
 *
 *  `isProducerSpeaking` is the assistant talking OUTSIDE this room's own turn
 *  — a schedule's line, the typed chat's, the daemon's native speaker. It is
 *  deliberately not gated on `isMuted`: muting closes the microphone, and a
 *  closed microphone does not stop the assistant from talking. */
export function displayOrbState(
  view: VoiceCommandSessionView,
  restingEnergy: number,
  isMuted: boolean,
  isProducerSpeaking = false,
): DisplayOrbState {
  return {
    energy: Math.max(
      restingEnergy,
      isMuted ? 0 : voiceEnergy(view),
      isProducerSpeaking ? SPEAKING_ENERGY : 0,
    ),
    // The one rule for "the mic is open" — shared with the voice stage rather
    // than restated here, so the orb and the overlay can never disagree.
    listening: voiceStageIsListening(view, isMuted),
    speaking: isProducerSpeaking || (!isMuted && view.state === "speaking"),
  };
}

/** A counter that ticks once per spoken clause as it STARTS playing — the orb
 *  mouths the sentence. Bound to the component's life: the player's observer
 *  list is module-level, so a Display that forgot to detach would be bumped
 *  by every reply for the rest of the session. */
export function useSpokenClauseSpike(): Ref<number> {
  const spikeKey = ref(0);
  const stopWatching = observeSpokenSentenceStart(() => {
    spikeKey.value += 1;
  });
  onUnmounted(stopWatching);
  return spikeKey;
}
