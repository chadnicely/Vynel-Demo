import { onMounted, onUnmounted, ref } from "vue";
import { liveChannelKeys } from "@vynel/contracts/chat/live-channel";
import type {
  VoiceRelayEvent,
  VoiceSurface,
} from "@vynel/contracts/voice/daemon-events";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import { createSpokenAudioPlayer } from "./spoken-audio-player.js";

// The browser end of the daemon's overlay channel. The always-on native daemon
// hears "Hey Vynel" locally (Moonshine — the room never leaves the machine)
// and publishes the wake here — since the live channel, over the window's ONE
// live socket (`voice:<surface>`): the api holds one link per surface to the
// daemon and relays its events, so a window no longer spends an HTTP-pool
// connection on an EventSource. The daemon's replay of an undelivered wake
// still lands: the relay reconnects for us and the wake replays through it.
// When the session closes we POST /session/end so the daemon takes the mic
// back. No daemon running is fine — the relay retries quietly and the overlay
// still works from its manual mic button.
//
// 'speak' events are the daemon delegating PLAYBACK: a `speak` tool call with
// no live overlay session (typed chat, a scheduled task) is sent to exactly one
// client — this one — which synthesizes + plays it. Queued sequentially so two
// proactive lines never talk over each other. Single delivery survives the
// relay: the daemon picks its newest client (the api), the api picks the
// surface's newest window.

export function useVoiceDaemonLink(options: {
  /** The daemon heard the wake phrase; `command` = same-breath text ('' if bare). */
  onWake: (command: string) => void;
  /** 'jarvis' = the floating window — the daemon prefers it for wake delivery. */
  surface?: VoiceSurface;
}) {
  const live = useLiveChannelStore();
  const isDaemonConnected = ref(false);
  // True while the daemon speaker is playing a `speak` reply — the overlay gates
  // its Web Speech mic on this so it never hears the daemon (cross-process, no
  // echo cancellation). The daemon publishes 'speaking' then 'idle' when done.
  const isDaemonSpeaking = ref(false);
  let release: (() => void) | null = null;

  // Daemon-delegated playback ('speak' events): one player, drained in order.
  const player = createSpokenAudioPlayer();
  const speakQueue: string[] = [];
  let drainingSpeakQueue = false;

  async function drainSpeakQueue(): Promise<void> {
    if (drainingSpeakQueue) return;
    drainingSpeakQueue = true;
    try {
      for (let text = speakQueue.shift(); text !== undefined; text = speakQueue.shift()) {
        // play() resolves on cancel/unreachable too — a bad line never wedges the queue.
        await player.play(text);
      }
    } finally {
      drainingSpeakQueue = false;
    }
  }

  function onEvent(raw: unknown): void {
    const event = raw as VoiceRelayEvent;
    if (event.kind === "daemon-link") isDaemonConnected.value = event.connected;
    else if (event.kind === "wake") options.onWake(event.command ?? "");
    else if (event.kind === "state") isDaemonSpeaking.value = event.state === "speaking";
    else if (event.kind === "speak" && event.text) {
      speakQueue.push(event.text);
      void drainSpeakQueue();
    }
  }

  onMounted(() => {
    release = live.subscribe(liveChannelKeys.voice(options.surface ?? "app"), {
      onEvent,
      // The socket itself dropped — the daemon light is off until the relay
      // says otherwise on the re-ack.
      onDetached: () => {
        isDaemonConnected.value = false;
      },
    });
  });

  onUnmounted(() => {
    release?.();
    release = null;
    isDaemonConnected.value = false;
    speakQueue.length = 0;
    player.cancel();
  });

  /** Tell the daemon the overlay's command session is over (best-effort — if
   *  the daemon is gone there is nothing to resume). */
  function notifySessionEnd(): void {
    void fetch("/voice/session/end", { method: "POST" }).catch(() => {});
  }

  return { isDaemonConnected, isDaemonSpeaking, notifySessionEnd };
}
