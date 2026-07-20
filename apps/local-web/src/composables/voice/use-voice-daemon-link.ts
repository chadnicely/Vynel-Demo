import { onMounted, onUnmounted, ref } from "vue";
import { createSpokenAudioPlayer } from "./spoken-audio-player.js";

// The browser end of the daemon's overlay channel. The always-on native daemon
// hears "Hey Vynel" locally (Moonshine — the room never leaves the machine)
// and publishes the wake here over SSE (`/voice` is the Vite proxy to the
// daemon's loopback port). An undelivered wake is replayed by the daemon when
// this link (re)connects — the same-breath command survives a window launch or
// an EventSource reconnect. When the session closes we POST /session/end so
// the daemon takes the mic back. No daemon running is fine — EventSource
// retries quietly and the overlay still works from its manual mic button.
//
// 'speak' events are the daemon delegating PLAYBACK: a `speak` tool call with
// no live overlay session (typed chat, a scheduled task) is sent to exactly one
// client — this one — which synthesizes + plays it. Queued sequentially so two
// proactive lines never talk over each other.

interface DaemonEvent {
  readonly kind: string;
  readonly command?: string;
  readonly state?: string;
  readonly text?: string;
}

export function useVoiceDaemonLink(options: {
  /** The daemon heard the wake phrase; `command` = same-breath text ('' if bare). */
  onWake: (command: string) => void;
  /** 'jarvis' = the floating window — the daemon prefers it for wake delivery. */
  surface?: "app" | "jarvis";
}) {
  const isDaemonConnected = ref(false);
  // True while the daemon speaker is playing a `speak` reply — the overlay gates
  // its Web Speech mic on this so it never hears the daemon (cross-process, no
  // echo cancellation). The daemon publishes 'speaking' then 'idle' when done.
  const isDaemonSpeaking = ref(false);
  let source: EventSource | null = null;

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

  onMounted(() => {
    // Environments without EventSource (happy-dom in tests) simply run with
    // no daemon link — the overlay still works from its manual mic button.
    if (typeof EventSource === "undefined") return;
    source = new EventSource(`/voice/events?surface=${options.surface ?? "app"}`);
    source.onopen = () => {
      isDaemonConnected.value = true;
    };
    source.onerror = () => {
      // EventSource reconnects on its own; the flag just drives the status dot.
      isDaemonConnected.value = false;
    };
    source.onmessage = (message: MessageEvent<string>) => {
      let event: DaemonEvent;
      try {
        event = JSON.parse(message.data) as DaemonEvent;
      } catch {
        return; // not ours — ignore a malformed frame rather than crash the link
      }
      if (event.kind === "wake") options.onWake(event.command ?? "");
      else if (event.kind === "state") isDaemonSpeaking.value = event.state === "speaking";
      else if (event.kind === "speak" && event.text) {
        speakQueue.push(event.text);
        void drainSpeakQueue();
      }
    };
  });

  onUnmounted(() => {
    source?.close();
    source = null;
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
