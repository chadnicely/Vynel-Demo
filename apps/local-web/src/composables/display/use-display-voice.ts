import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { DisplaySessionPhase } from "@vynel/contracts/voice/daemon-events";
import { useUiStore } from "../../stores/ui-store.js";
import { useVoiceSession } from "../voice/use-voice-session.js";
import { useVoiceDaemonLink } from "../voice/use-voice-daemon-link.js";
import {
  voiceStageCaption,
  voiceStageIsListening,
  voiceStageOrbState,
} from "../../components/voice/voice-stage-view.js";
import { useDisplaySessionAnnounce } from "./use-display-session-announce.js";
import type { DisplayDaemonLeg } from "./display-orb-state.js";

// The window's Display voice — ONE session, ONE daemon link, ONE mirror
// announcement, for as long as the window lives.
//
// It used to belong to the room (`DisplayView` started it on mount and ended it
// on unmount), which made "voice on" and "looking at the Display" the same
// fact — so walking away from the room hung up the call, and the display dock,
// whose whole job is to mirror that call from the corner while you work
// elsewhere, could never be reached. The switch in the title bar is the real
// voice on/off now: turning it on starts the conversation AND shows the room,
// leaving the room keeps the conversation, coming back re-attaches to the same
// one, turning it off ends it from wherever you are.
//
// A window-lifetime store rather than a module singleton because that is how
// this app already holds window-lifetime machinery that needs the injected SDK
// client (`stores/live-turn-registry.ts`), and because a store is disposed with
// the app — which is exactly when a voice session should end.
//
// `ownsVoice` is the single predicate for "the Display feature holds this
// window's microphone": it gates the daemon link here AND the `VoiceOverlay`
// mount in the shell, so the two can never both be listening.

export const useDisplayVoice = defineStore("display-voice", () => {
  const ui = useUiStore();

  /** The switch: voice is ON. Deliberately NOT `session is running` — idle
   *  silence ends the recognizer while the conversation stays the user's (the
   *  room says "Resume", a wake restarts it), and only `end()` gives the
   *  microphone back for good. */
  const isLive = ref(false);
  const isMuted = ref(false);
  /** Announced by `use-display-toggle`, the one reading of whether the room is
   *  on screen. Pushed rather than read, because the toggle needs this store
   *  and the store must not need the toggle back. */
  const isRoomOnScreen = ref(false);
  const ownsVoice = computed(() => isLive.value || isRoomOnScreen.value);

  /** A wake landed while this store held the link, and the room is elsewhere.
   *  The store cannot open the room (that is the toggle's job), so it rings and
   *  the toggle answers. */
  const showDisplayRequestCount = ref(0);

  // Hoisted handlers so the two composables can reference each other's owners —
  // both callbacks only ever fire after setup completes.
  const voice = useVoiceSession({ onEnded: handleSessionEnded, onStarted: handleSessionStarted });
  const daemon = useVoiceDaemonLink({
    onWake: handleWake,
    ownLiveSessionId: voice.currentSessionId,
    speakThroughSession: voice.speakExternal,
    onShowDisplay: () => {
      showDisplayRequestCount.value += 1;
    },
    enabled: ownsVoice,
  });

  // Idle silence ends the session and voice stays ON — it is a conversation
  // with a pause in it, not a hang-up. The daemon takes the microphone back so
  // the wake word works again, and the wake below brings us straight back.
  // (This also fires when the user MUTES, which ends the session on purpose —
  // clearing `isMuted` here would undo the mute they just asked for.)
  function handleSessionEnded(): void {
    daemon.notifySessionEnd();
  }

  // The room's recognizer has the microphone now — the daemon must stop running
  // its native STT over the same speech (it only ever knew about sessions its
  // own wake handed over).
  function handleSessionStarted(): void {
    daemon.notifySessionStart();
  }

  // A wake the daemon handed to THIS window: it is already non-idle when this
  // lands (it publishes `wake` before the event), so the wake goes straight to
  // the session rather than through the gate that exists to keep the room off
  // somebody else's conversation. Refusing it here would swallow the wake.
  function handleWake(command: string, turnWatchdogMs?: number): void {
    beginSession(command || undefined, turnWatchdogMs);
  }

  /** The ONE door to a live recognizer: every entry point — the switch, the
   *  room's pills, the palette, a wake — comes through here, so a running
   *  session always has `isLive` behind it. A session started any other way
   *  would be released by `ownsVoice` going false the moment the user left the
   *  room, mid-sentence. */
  function beginSession(initialCommand?: string, turnWatchdogMs?: number): void {
    // The overlay is this window's OTHER voice. Closing it ends its session
    // right here — its watcher is `flush: 'sync'` for exactly this line — so
    // the recognizer below never opens beside a second one.
    ui.isVoiceOverlayOpen = false;
    isLive.value = true;
    isMuted.value = false;
    if (!voice.isActive.value) voice.start(initialCommand, turnWatchdogMs);
  }

  /** Voice ON, when the room may take the microphone at all.
   *
   *  It may not while the OTHER leg holds the conversation — a wake the daemon
   *  answered natively, or one it handed to the display dock. That session
   *  cannot migrate into this window (no mid-turn move of a Web Speech
   *  session), so a second recognizer here would only talk over it. The room
   *  mirrors it instead and its pill says who is listening.
   *
   *  The daemon's phase alone is not the test: when the wake landed in THIS
   *  window the daemon also sits non-idle (`handed-off`) for the whole session
   *  — and that one IS ours, which `voice.isActive` is exactly the proof of. */
  const isVoiceHeldElsewhere = computed(
    () => daemon.daemonState.value !== "idle" && !voice.isActive.value,
  );

  function start(): void {
    if (isVoiceHeldElsewhere.value) return;
    beginSession();
  }

  /** Voice OFF — from the room or from anywhere else. */
  function end(): void {
    isLive.value = false;
    isMuted.value = false;
    voice.end();
  }

  /** The microphone switch. Muting always works; taking the microphone BACK
   *  goes through `start()`, so an unmute can no more talk over the dock's
   *  conversation than a fresh start can. On a session the idle timer ended the
   *  first click brings the mic back too — muting what is already silent would
   *  leave the pills contradicting each other and cost the user a second
   *  click. */
  function toggleMute(): void {
    if (isMuted.value || !voice.isActive.value) {
      start();
      return;
    }
    isMuted.value = true;
    voice.end();
  }

  function setRoomOnScreen(onScreen: boolean): void {
    isRoomOnScreen.value = onScreen;
  }

  // The OTHER leg: a wake the daemon answered natively, or one it handed to the
  // dock window. The conversation is the assistant's either way, so the room's
  // orb mirrors it — behind our own session, which always wins the microphone.
  const daemonLeg = computed<DisplayDaemonLeg>(() => ({
    state: daemon.daemonState.value,
    isPlayingRelayedLine: daemon.isPlayingRelayedLine.value,
  }));

  const caption = computed(() =>
    voiceStageCaption(voice.view.value, isMuted.value, voice.failure.value),
  );
  const isListening = computed(() => voiceStageIsListening(voice.view.value, isMuted.value));

  // The stage's orb vocabulary is the wire's plus `wake`, which belongs to the
  // daemon leg and never comes out of our own session — so the phase reads the
  // one mapping rather than keeping a second copy of it.
  const sessionPhase = computed<DisplaySessionPhase>(() => {
    const orb = voiceStageOrbState(voice.view.value, isMuted.value);
    return orb === "wake" ? "listening" : orb;
  });

  // The mirror the display dock draws in the corner. It rides the STORE, not
  // the room, which is the whole point: the dock keeps showing the conversation
  // after the user walks away from the Display. Muted counts as live — a muted
  // conversation is paused, not ended, and the row says so.
  useDisplaySessionAnnounce(() => ({
    live: voice.isActive.value || isMuted.value,
    phase: sessionPhase.value,
    caption: caption.value,
  }));

  return {
    view: voice.view,
    failure: voice.failure,
    /** A recognizer is running right now — narrower than `isLive`. */
    isActive: voice.isActive,
    isMuted,
    isLive,
    ownsVoice,
    isVoiceHeldElsewhere,
    daemonLeg,
    caption,
    isListening,
    showDisplayRequestCount,
    setRoomOnScreen,
    start,
    end,
    toggleMute,
  };
});
