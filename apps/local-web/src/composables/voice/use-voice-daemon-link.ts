import { onMounted, onUnmounted, ref } from "vue";

// The browser end of the daemon's overlay channel. The always-on native daemon
// hears "Hey Vynel" locally (Moonshine — the room never leaves the machine)
// and publishes the wake here over SSE (`/voice` is the Vite proxy to the
// daemon's loopback port). An undelivered wake is replayed by the daemon when
// this link (re)connects — the same-breath command survives a window launch or
// an EventSource reconnect. When the session closes we POST /session/end so
// the daemon takes the mic back. No daemon running is fine — EventSource
// retries quietly and the overlay still works from its manual mic button.

interface DaemonEvent {
  readonly kind: string;
  readonly command?: string;
}

export function useVoiceDaemonLink(options: {
  /** The daemon heard the wake phrase; `command` = same-breath text ('' if bare). */
  onWake: (command: string) => void;
  /** 'jarvis' = the floating window — the daemon prefers it for wake delivery. */
  surface?: "app" | "jarvis";
}) {
  const isDaemonConnected = ref(false);
  let source: EventSource | null = null;

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
    };
  });

  onUnmounted(() => {
    source?.close();
    source = null;
  });

  /** Tell the daemon the overlay's command session is over (best-effort — if
   *  the daemon is gone there is nothing to resume). */
  function notifySessionEnd(): void {
    void fetch("/voice/session/end", { method: "POST" }).catch(() => {});
  }

  return { isDaemonConnected, notifySessionEnd };
}
