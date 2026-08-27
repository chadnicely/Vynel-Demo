import {
  computed,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";
import { liveChannelKeys } from "@vynel/contracts/chat/live-channel";
import { parseVoiceControlEvent } from "@vynel/contracts/voice/daemon-events";
import type {
  DisplaySessionPhase,
  VoiceControlEvent,
  VoiceRelayEvent,
  VoiceSubscriber,
  VoiceSurface,
} from "@vynel/contracts/voice/daemon-events";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import { isWebSpeechAvailable } from "./speech-recognition.js";
import { createSpokenAudioPlayer } from "./spoken-audio-player.js";
import { isTauriShell } from "./tauri-overlay-window.js";

// The browser end of the daemon's overlay channel. The always-on native daemon
// hears "Hey Vynel" locally (Moonshine — the room never leaves the machine)
// and publishes the wake here — since the live channel, over the window's ONE
// live socket (`voice:<surface>[:wake]`): the api holds one link per subscriber
// kind to the daemon and relays its events, so a window no longer spends an
// HTTP-pool connection on an EventSource. The daemon's replay of an undelivered
// wake still lands: the relay reconnects for us and the wake replays through
// it. When a session OPENS we POST /session/start and when it closes
// /session/end, so the daemon knows a web recognizer owns the microphone and
// stops running its own native STT over the same room (its wake handoff only
// ever covered sessions IT started). No daemon running is fine — the relay retries quietly and the overlay
// still works from its manual mic button.
//
// 'speak' events are the daemon delegating PLAYBACK: a `speak` tool call from
// another producer (typed chat, a scheduled task) is sent to exactly one
// client — this one — which synthesizes + plays it: through the live voice
// session's own player while a turn is in flight (one queue, one echo filter),
// else on this link's side player, queued sequentially so two proactive lines
// never talk over each other. Single delivery survives the relay: the daemon
// picks its owner (else newest) upstream, the api picks the window that took
// the wake (else the surface's newest).
//
// Three frames on this channel are about WINDOWS rather than speech, and all
// exist because the app window and the display dock cannot see each other:
// 'show-display' is the daemon asking the app to come forward on the Display
// (a wake landed, the dock is taking it), 'display-active' is the app
// answering whether the room is on screen — which is how the dock knows to get
// out of its way — and 'display-session' is the conversation the room is
// HOLDING, which is how the dock mirrors a session it does not own.

/** The daemon's own conversation phase, as its `state` frames publish it. The
 *  wire carries a bare string, so an unknown phase from a newer daemon reads as
 *  `idle` rather than parking a surface in something it cannot interpret.
 *  `wake` is the moment the phrase landed; `handed-off` is where the
 *  conversation then SITS for its whole life when another window runs it — the
 *  daemon says nothing more until the handoff ends and it returns to `idle`.
 *  Both mean "someone is in the room": neither carries energy of its own, and
 *  both keep a mirroring orb listening. */
const VOICE_DAEMON_STATES = [
  "idle",
  "wake",
  "handed-off",
  "listening",
  "thinking",
  "speaking",
] as const;

export type VoiceDaemonState = (typeof VOICE_DAEMON_STATES)[number];

/** The conversation another window (the app's Display room) is holding — what
 *  a mirroring surface draws when it has none of its own. */
export interface AppDisplaySession {
  readonly live: boolean;
  readonly phase: DisplaySessionPhase;
  /** The last line of it, as the room's own caption reads. */
  readonly caption: string;
}

function toVoiceDaemonState(state: string): VoiceDaemonState {
  return VOICE_DAEMON_STATES.find((known) => known === state) ?? "idle";
}

/** Can THIS window run a wake session? A HOST declaration, not a feature
 *  detect: the display dock always declares it (it exists for
 *  wakes); the desktop shell's app window NEVER does — WebView2 ships Web
 *  Speech, so a detect would make the main window a wake target and the wake
 *  would land in the app (or the shell's hidden dock webview) instead of
 *  the native leg when the window feature is off; a plain browser tab keeps
 *  the pre-window behavior and takes a wake only with Web Speech (a tab
 *  without it that took one would swallow it while the daemon waits, deaf). */
function describeVoiceSubscriber(surface: VoiceSurface): VoiceSubscriber {
  return {
    surface,
    wake: surface === "dock" || (!isTauriShell() && isWebSpeechAvailable()),
  };
}

export function useVoiceDaemonLink(options: {
  /** The daemon heard the wake phrase; `command` = same-breath text ('' if
   *  bare), `turnWatchdogMs` = the daemon's silence bound for the session's
   *  turns (undefined from an older daemon — the session uses its default). */
  onWake: (command: string, turnWatchdogMs?: number) => void;
  /** 'dock' = the display dock window — the daemon prefers it for wake delivery. */
  surface?: VoiceSurface;
  /** The chat session THIS window's own overlay turn is running on right now
   *  (null when none). A relayed 'speak' produced by that very session is our
   *  own voice — the overlay already speaks its turn off its own stream, so the
   *  relayed copy would double-play and is dropped. Every other producer (a
   *  schedule, the typed chat) plays here even mid-turn. */
  ownLiveSessionId?: () => string | null;
  /** Hand a relayed line to THIS window's live voice session. Mid-turn the
   *  session's player has the room and its mic is open — a second player would
   *  talk over the reply, and its line, unknown to the session's echo filter,
   *  could come back off the speaker as a barge-in. The session queues it in
   *  order and remembers it; false = no turn in flight, the line plays on this
   *  link's own player (a proactive line in an idle window). */
  speakThroughSession?: (text: string) => boolean;
  /** The daemon asks the DESKTOP APP to come forward on the Display — a wake
   *  landed and the display dock is taking the conversation, so the room should
   *  be the thing the user is looking at. Only app surfaces are ever sent it. */
  onShowDisplay?: () => void;
  /** The daemon says a spoken line is about to play SOMEWHERE and the dock
   *  should be on screen for it. Only dock surfaces are ever sent it —
   *  broadcast, since the audio itself is single-delivery and may land in a
   *  different window than the one that must appear. `text` = the line's
   *  opening for the row's caption (null from an older daemon). */
  onShowDock?: (text: string | null) => void;
  /** Whether this link should hold the channel right now. Default true — a
   *  view's link lives exactly as long as the view. The Display's voice lives
   *  in a window-lifetime store instead, and a window must never hold TWO
   *  links (two players, every relayed line spoken twice), so that one hands
   *  the channel back to `VoiceOverlay` whenever the Display does not own the
   *  window's voice. */
  enabled?: MaybeRefOrGetter<boolean>;
}) {
  const live = useLiveChannelStore();
  const isDaemonConnected = ref(false);
  // The daemon leg's phase — a wake it answered natively, or one it handed to
  // the wake window. A surface with an orb (the Display) mirrors the whole
  // conversation off it, not just its voice.
  const daemonState = ref<VoiceDaemonState>("idle");
  // The one phase a surface may care about on its own: the daemon's speaker is
  // busy, so a Web Speech mic opened here would hear it (cross-process, no echo
  // cancellation). Derived, never stored twice.
  const isDaemonSpeaking = computed(() => daemonState.value === "speaking");
  // Is the APP window's Display on screen right now? Published by that window
  // (`voice.setDisplayActive`) and fanned by the api to every voice window of
  // the user — the display dock cannot see the app's screen, and this is the
  // whole basis of its hide/reveal rule (two orbs for one conversation would be
  // two assistants). False until a frame says otherwise.
  //
  // Deliberately NOT reset when the socket drops, unlike `daemonState`: a stale
  // PHASE gates a microphone, while this only decides which window draws the
  // orb — and the api replays the last value on re-subscribe, so a blip that
  // reset it would flash the dock open and shut for nothing.
  const isAppDisplayActive = ref(false);
  // The conversation the APP window's room is holding, as it announced it —
  // null until it says anything. The dock MIRRORS this when it has no
  // conversation of its own: a session started in the room is the primary path,
  // and a Web Speech session cannot migrate across windows, so the dock shows
  // it rather than taking it. Not reset on a socket blip, for the same reason
  // `isAppDisplayActive` isn't: the api replays the last value on re-subscribe.
  const appDisplaySession = ref<AppDisplaySession | null>(null);
  let release: (() => void) | null = null;

  // Daemon-delegated playback ('speak' events): one player, drained in order.
  // A refusal goes BACK to the daemon: autoplay policy can reject play() in a
  // window with no user gesture (the hidden dock webview, a fresh app-window),
  // and the daemon — which already logged the line as delivered — is the only
  // party with another speaker to try. Best-effort, the presence-call precedent.
  const player = createSpokenAudioPlayer({
    onPlaybackRefused: (text) => {
      void fetch("/voice/speak-refused", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      }).catch(() => {});
    },
  });
  const speakQueue: string[] = [];
  // The drain's re-entrancy guard, and the ONE reading of "this window is
  // speaking another producer's line" — a surface with an orb (the Display)
  // shows the assistant talking off it. `isDaemonSpeaking` is a different
  // speaker: the daemon's own, on the machine's speakers.
  const isPlayingRelayedLine = ref(false);
  // The line in flight, so a surface with a caption row (the dock's mini row)
  // can SHOW what is being said rather than an empty row beside a voice.
  const relayedLineText = ref<string | null>(null);

  async function drainSpeakQueue(): Promise<void> {
    if (isPlayingRelayedLine.value) return;
    isPlayingRelayedLine.value = true;
    try {
      for (let text = speakQueue.shift(); text !== undefined; text = speakQueue.shift()) {
        relayedLineText.value = text;
        // play() resolves on cancel/unreachable too — a bad line never wedges the queue.
        await player.play(text);
      }
    } finally {
      isPlayingRelayedLine.value = false;
      relayedLineText.value = null;
    }
  }

  function isOwnVoice(producerSessionId: string | null): boolean {
    return producerSessionId !== null && producerSessionId === options.ownLiveSessionId?.();
  }

  function applyControl(control: VoiceControlEvent): void {
    if (control.kind === "display-active") {
      isAppDisplayActive.value = control.active;
      return;
    }
    appDisplaySession.value = {
      live: control.live,
      phase: control.phase,
      caption: control.caption,
    };
  }

  function onEvent(raw: unknown): void {
    // The api's own words go through their own door — a malformed control frame
    // is ignored rather than coerced into a window state nobody announced.
    const control = parseVoiceControlEvent(raw);
    if (control !== null) {
      applyControl(control);
      return;
    }
    const event = raw as VoiceRelayEvent;
    if (event.kind === "daemon-link") {
      isDaemonConnected.value = event.connected;
      // No link = no conversation to mirror; a stale phase would keep the mic
      // gated and the Display's orb lit for a daemon that is gone.
      if (!event.connected) daemonState.value = "idle";
    } else if (event.kind === "wake") {
      options.onWake(event.command ?? "", event.turnWatchdogMs);
    } else if (event.kind === "state") {
      daemonState.value = toVoiceDaemonState(event.state);
    } else if (event.kind === "show-display") {
      options.onShowDisplay?.();
    } else if (event.kind === "show-dock") {
      options.onShowDock?.(event.text ?? null);
    } else if (event.kind === "speak" && event.text) {
      // An older relay omits the producer: unknown is never "ours".
      if (isOwnVoice(event.sessionId ?? null)) return;
      if (options.speakThroughSession?.(event.text)) return;
      speakQueue.push(event.text);
      void drainSpeakQueue();
    }
  }

  function attach(): void {
    if (release !== null) return;
    const subscriber = describeVoiceSubscriber(options.surface ?? "app");
    release = live.subscribe(liveChannelKeys.voice(subscriber), {
      onEvent,
      // The socket itself dropped — the daemon light is off until the relay
      // says otherwise on the re-ack.
      onDetached: () => {
        isDaemonConnected.value = false;
        daemonState.value = "idle";
      },
    });
  }

  function detach(): void {
    release?.();
    release = null;
    isDaemonConnected.value = false;
    // No link, no conversation: a phase kept from a channel we no longer hear
    // would gate a microphone on news that can never arrive.
    daemonState.value = "idle";
    // The drain's own `finally` clears `isPlayingRelayedLine` — cancel() makes
    // the line in flight resolve and the emptied queue ends the loop. Clearing
    // it here instead would open the re-entrancy guard while it still runs.
    speakQueue.length = 0;
    player.cancel();
  }

  // SYNC on purpose: the other half of "exactly one link per window" is a
  // `v-if` in the shell, and a queued job would let the two overlap for a tick
  // — long enough for one relayed line to play on two players.
  watch(() => toValue(options.enabled ?? true), (on) => (on ? attach() : detach()), {
    immediate: true,
    flush: "sync",
  });

  onScopeDispose(detach);

  /** Tell the daemon a web recognizer just took the microphone, so its native
   *  STT stops transcribing the same speech (best-effort — no daemon, nothing
   *  to hand over). Announced for EVERY session, wake-started or not: the
   *  daemon's own handoff is idempotent, and a session the user started from
   *  the Display switch has no wake to have announced it. */
  function notifySessionStart(): void {
    void fetch('/voice/session/start', { method: 'POST' }).catch(() => {});
  }

  /** Tell the daemon the overlay's command session is over (best-effort — if
   *  the daemon is gone there is nothing to resume). */
  function notifySessionEnd(): void {
    void fetch("/voice/session/end", { method: "POST" }).catch(() => {});
  }

  return {
    isDaemonConnected,
    daemonState,
    isDaemonSpeaking,
    isAppDisplayActive,
    appDisplaySession,
    isPlayingRelayedLine,
    relayedLineText,
    notifySessionStart,
    notifySessionEnd,
  };
}
