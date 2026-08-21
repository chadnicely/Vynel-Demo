import { onUnmounted, ref, type Ref } from "vue";
import { voiceStageIsListening } from "../../components/voice/voice-stage-view.js";
import { observeSpokenSentenceStart } from "../voice/spoken-audio-player.js";
import type { VoiceDaemonState } from "../voice/use-voice-daemon-link.js";
import type {
  VoiceCommandSessionState,
  VoiceCommandSessionView,
} from "../voice/voice-command-session-types.js";

// What the Display's orb does, in one place. The renderer takes three dials
// (energy, listening, speaking) plus a spike per spoken clause; everything
// below is the mapping from what the room actually knows onto those dials.
//
// The room knows about TWO legs. Its own is the in-app Web Speech session; the
// other is the native wake daemon's — a wake it answered itself, or one it
// handed to the wake window while this room stayed open. Both are the same
// assistant, so both drive the same orb.

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
// something for YOU right now, whatever the rest of the fleet is up to. Both
// legs name their phases the same way, so one mapping serves them: the same
// work never glows two different ways depending on who is doing it.
const SPEAKING_ENERGY = 0.95;
const THINKING_ENERGY = 0.7;

function phaseEnergy(phase: VoiceCommandSessionState | VoiceDaemonState): number {
  if (phase === "speaking") return SPEAKING_ENERGY;
  if (phase === "thinking") return THINKING_ENERGY;
  return 0;
}

/** The daemon leg as the room sees it: the wake daemon's own phase (its `state`
 *  frames), and whether THIS window's player is speaking a line the daemon
 *  relayed to it. */
export interface DisplayDaemonLeg {
  readonly state: VoiceDaemonState;
  readonly isPlayingRelayedLine: boolean;
}

/** No daemon on the line — the room's own session is all there is. */
const SILENT_DAEMON_LEG: DisplayDaemonLeg = { state: "idle", isPlayingRelayedLine: false };

/** The orb's dials. `restingEnergy` is the fleet's (`activityEnergy`); a voice
 *  leg only ever lifts it, never dims it — a quiet mic must not hide that six
 *  sessions are running.
 *
 *  PRECEDENCE: the room's OWN live session wins. The daemon leg lights the orb
 *  only while that session is ended or muted — one orb must never claim two
 *  open microphones, and the room's is the one the user is sitting in front of.
 *  (The two can rarely both be live: the daemon either hands the conversation
 *  off or answers it natively. The rule is the belt for the mute and handover
 *  windows.) SPEAKING is deliberately not exclusive and not gated on `isMuted`:
 *  whoever's speaker it is — a relayed schedule line here, the daemon's own
 *  voice there — the assistant IS talking, and muting closes the microphone,
 *  not its mouth. */
export function displayOrbState(
  view: VoiceCommandSessionView,
  restingEnergy: number,
  isMuted: boolean,
  daemon: DisplayDaemonLeg = SILENT_DAEMON_LEG,
): DisplayOrbState {
  // The one rule for "the mic is open" — shared with the voice stage rather
  // than restated here, so the orb and the overlay can never disagree.
  const ownSessionIsLive = voiceStageIsListening(view, isMuted);
  const daemonDrivesTheRoom = !ownSessionIsLive;
  const isDaemonSpeaking = daemon.state === "speaking" || daemon.isPlayingRelayedLine;
  return {
    energy: Math.max(
      restingEnergy,
      isMuted ? 0 : phaseEnergy(view.state),
      isDaemonSpeaking ? SPEAKING_ENERGY : 0,
      daemonDrivesTheRoom ? phaseEnergy(daemon.state) : 0,
    ),
    // 'idle' is the daemon's "ended" — every other phase keeps its microphone
    // open, exactly as the room's own session listens through its own reply.
    // A handed-off conversation parks at 'wake' for its whole life, so that
    // one is what mirrors the wake window.
    listening: ownSessionIsLive || (daemonDrivesTheRoom && daemon.state !== "idle"),
    speaking: (!isMuted && view.state === "speaking") || isDaemonSpeaking,
  };
}

/** A counter that ticks once per spoken clause as it STARTS playing — the orb
 *  mouths the sentence. Bound to the component's life: the player's observer
 *  list is module-level, so a Display that forgot to detach would be bumped
 *  by every reply for the rest of the session.
 *
 *  That module-level list is also what carries the daemon leg: a RELAYED line
 *  plays on the daemon link's own browser player and spikes the orb like any
 *  other. A line the daemon speaks NATIVELY never does — it is synthesized and
 *  played in the daemon process, so nothing about it crosses into this window.
 *  The orb still burns and reads `speaking` for it; only the per-clause spike
 *  is out of reach. */
export function useSpokenClauseSpike(): Ref<number> {
  const spikeKey = ref(0);
  const stopWatching = observeSpokenSentenceStart(() => {
    spikeKey.value += 1;
  });
  onUnmounted(stopWatching);
  return spikeKey;
}
