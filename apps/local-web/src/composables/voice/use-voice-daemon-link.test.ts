// The daemon link over the live channel: subscribes `voice:<surface>[:wake]`
// on the window's socket (the wake capability rides the key), reads the
// relay's link light, routes wake/state/speak — dropping only a relayed copy
// of this window's OWN turn — and releases the channel on unmount.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
import type { LiveChannelServerFrame } from "@vynel/contracts/chat/live-channel";
import {
  installFakeLiveSocket,
  latestFakeLiveSocket,
} from "../../stores/live-channel-test-support.js";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";

// The player synthesizes through the daemon — stub it: we only need to see
// which lines were asked to play.
const played: string[] = [];
vi.mock("./spoken-audio-player.js", () => ({
  createSpokenAudioPlayer: () => ({
    play: async (text: string) => {
      played.push(text);
    },
    cancel: () => {},
  }),
}));

import { useVoiceDaemonLink } from "./use-voice-daemon-link.js";

let restoreSocket: () => void;
let wrapper: VueWrapper | null = null;
beforeEach(() => {
  restoreSocket = installFakeLiveSocket();
  played.length = 0;
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  restoreSocket();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

/** happy-dom ships no SpeechRecognition — this stands one up, as Chrome would. */
function installWebSpeech(): void {
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class {};
}

/** The desktop shell's `withGlobalTauri` namespace — what isTauriShell() reads. */
function installTauriShell(): void {
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = { window: {} };
}

function mountLink(
  surface: "app" | "jarvis" = "app",
  ownLiveSessionId?: () => string | null,
  speakThroughSession?: (text: string) => boolean,
) {
  const onWake = vi.fn();
  let link!: ReturnType<typeof useVoiceDaemonLink>;
  const Host = defineComponent({
    setup() {
      link = useVoiceDaemonLink({
        onWake,
        surface,
        ...(ownLiveSessionId !== undefined ? { ownLiveSessionId } : {}),
        ...(speakThroughSession !== undefined ? { speakThroughSession } : {}),
      });
      return () => h("div");
    },
  });
  wrapper = mount(Host, { global: { plugins: [createPinia()] } });
  const socket = latestFakeLiveSocket();
  socket.serverOpens();
  return { link: () => link, onWake, socket };
}

/** A relayed speak frame; `sessionId` omitted = what an older relay sends. */
const speak = (channel: string, text: string, sessionId?: string | null) =>
  ({
    kind: "event",
    channel,
    event: { kind: "speak", text, ...(sessionId !== undefined ? { sessionId } : {}) },
  }) as LiveChannelServerFrame;

describe("useVoiceDaemonLink (live channel)", () => {
  it("the Jarvis window always subscribes wake-capable and follows the relay's link light", () => {
    const { link, socket } = mountLink("jarvis");
    expect(socket.takeSent()).toEqual([{ op: "subscribe", channels: ["voice:jarvis:wake"] }]);
    expect(link().isDaemonConnected.value).toBe(false);
    socket.serverAcks("voice:jarvis:wake");
    socket.serverSends({
      kind: "event",
      channel: "voice:jarvis:wake",
      event: { kind: "daemon-link", connected: true },
    });
    expect(link().isDaemonConnected.value).toBe(true);
    socket.serverDrops();
    expect(link().isDaemonConnected.value).toBe(false);
  });

  it("a browser app window declares the wake capability only when Web Speech exists in it", () => {
    // Without recognition (Firefox) it must never be handed a wake — it would
    // swallow it while the daemon waits, deaf.
    const without = mountLink("app");
    expect(without.socket.takeSent()).toEqual([{ op: "subscribe", channels: ["voice:app"] }]);
    wrapper!.unmount();
    wrapper = null;

    installWebSpeech();
    const withSpeech = mountLink("app");
    expect(withSpeech.socket.takeSent()).toEqual([
      { op: "subscribe", channels: ["voice:app:wake"] },
    ]);
  });

  it("the desktop shell's app window NEVER declares it — even though WebView2 ships Web Speech", () => {
    // A host declaration, not a feature detect: with the jarvis window feature
    // off, a wake must reach the native leg — not land in the main window (or
    // the shell's hidden jarvis webview) where nobody would hear it.
    installTauriShell();
    installWebSpeech();
    const { socket } = mountLink("app");
    expect(socket.takeSent()).toEqual([{ op: "subscribe", channels: ["voice:app"] }]);
    wrapper!.unmount();
    wrapper = null;

    // The shell's jarvis webview itself still does — it exists for wakes.
    const jarvis = mountLink("jarvis");
    expect(jarvis.socket.takeSent()).toEqual([{ op: "subscribe", channels: ["voice:jarvis:wake"] }]);
  });

  it("routes wake (with the daemon's watchdog bound), speaking state and delegated speech", () => {
    installWebSpeech();
    const { link, onWake, socket } = mountLink();
    socket.serverAcks("voice:app:wake");
    socket.serverSends({
      kind: "event",
      channel: "voice:app:wake",
      event: { kind: "wake", command: "open mail", turnWatchdogMs: 300_000 },
    });
    expect(onWake).toHaveBeenCalledWith("open mail", 300_000);
    // An older daemon carries no bound — the session falls back to its default.
    socket.serverSends({
      kind: "event",
      channel: "voice:app:wake",
      event: { kind: "wake", command: "" },
    });
    expect(onWake).toHaveBeenLastCalledWith("", undefined);
    socket.serverSends({ kind: "event", channel: "voice:app:wake", event: { kind: "state", state: "speaking" } });
    expect(link().isDaemonSpeaking.value).toBe(true);
    socket.serverSends({ kind: "event", channel: "voice:app:wake", event: { kind: "state", state: "idle" } });
    expect(link().isDaemonSpeaking.value).toBe(false);
    socket.serverSends(speak("voice:app:wake", "good morning", "sched-1"));
    expect(played).toEqual(["good morning"]);
  });

  it("drops a relayed line only when it was produced by this window's own live turn", async () => {
    // The overlay speaks its own turn off its own stream; the daemon relays
    // every speak it receives, so a copy from OUR session would double-play —
    // but another producer's line (a schedule, the typed chat) must play here
    // even mid-turn: nobody else will voice it.
    let ownSessionId: string | null = "voice-seg-7";
    const { socket } = mountLink("app", () => ownSessionId);
    socket.serverAcks("voice:app");
    socket.serverSends(speak("voice:app", "own turn line", "voice-seg-7"));
    expect(played).toEqual([]);
    socket.serverSends(speak("voice:app", "a schedule's line", "sched-1"));
    expect(played).toEqual(["a schedule's line"]);
    // An unknown producer is never "ours" — null from the daemon, absent from an older relay.
    socket.serverSends(speak("voice:app", "unknown producer", null));
    socket.serverSends(speak("voice:app", "older relay"));
    // Between turns nothing is ours — even the same id plays (it can't be our voice then).
    ownSessionId = null;
    socket.serverSends(speak("voice:app", "after the turn", "voice-seg-7"));
    // The player queue drains in order, one awaited line at a time.
    await vi.waitFor(() =>
      expect(played).toEqual(["a schedule's line", "unknown producer", "older relay", "after the turn"]),
    );
  });

  it("hands a relayed line to the live voice session mid-turn, else plays it on the side player", async () => {
    // Mid-turn the session's player has the room and its mic is open: a second
    // player would talk over the reply, and its line — unknown to the session's
    // echo filter — could come back as a barge-in. The session takes it then.
    let turnInFlight = true;
    const takenBySession: string[] = [];
    const speakThroughSession = vi.fn((text: string) => {
      if (!turnInFlight) return false;
      takenBySession.push(text);
      return true;
    });
    const { socket } = mountLink("jarvis", () => "voice-seg-7", speakThroughSession);
    socket.serverAcks("voice:jarvis:wake");
    socket.serverSends(speak("voice:jarvis:wake", "your build is green", "sched-1"));
    expect(takenBySession).toEqual(["your build is green"]);
    expect(played).toEqual([]);
    // Our own turn's copy is still dropped BEFORE the session is even asked.
    socket.serverSends(speak("voice:jarvis:wake", "own turn line", "voice-seg-7"));
    expect(speakThroughSession).toHaveBeenCalledTimes(1);
    // No turn in flight → the session declines → the side player, as before.
    turnInFlight = false;
    socket.serverSends(speak("voice:jarvis:wake", "lunch in five", null));
    await vi.waitFor(() => expect(played).toEqual(["lunch in five"]));
    expect(takenBySession).toEqual(["your build is green"]);
  });

  it("releases the channel on unmount", () => {
    const { socket } = mountLink();
    socket.serverAcks("voice:app");
    socket.takeSent();
    const live = useLiveChannelStore();
    expect(live.channelCount()).toBe(1);
    wrapper!.unmount();
    wrapper = null;
    expect(live.channelCount()).toBe(0);
    expect(socket.takeSent()).toEqual([{ op: "unsubscribe", channels: ["voice:app"] }]);
  });
});
