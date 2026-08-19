// The daemon link over the live channel: subscribes `voice:<surface>` on the
// window's socket, reads the relay's link light, routes wake/state/speak, and
// releases the channel on unmount.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia } from "pinia";
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
});

function mountLink(
  surface: "app" | "jarvis" = "app",
  isPlayingOwnTurn?: () => boolean,
) {
  const onWake = vi.fn();
  let link!: ReturnType<typeof useVoiceDaemonLink>;
  const Host = defineComponent({
    setup() {
      link = useVoiceDaemonLink({
        onWake,
        surface,
        ...(isPlayingOwnTurn !== undefined ? { isPlayingOwnTurn } : {}),
      });
      return () => h("div");
    },
  });
  wrapper = mount(Host, { global: { plugins: [createPinia()] } });
  const socket = latestFakeLiveSocket();
  socket.serverOpens();
  return { link: () => link, onWake, socket };
}

describe("useVoiceDaemonLink (live channel)", () => {
  it("subscribes the surface's voice channel and follows the relay's link light", () => {
    const { link, socket } = mountLink("jarvis");
    expect(socket.takeSent()).toEqual([{ op: "subscribe", channels: ["voice:jarvis"] }]);
    expect(link().isDaemonConnected.value).toBe(false);
    socket.serverAcks("voice:jarvis");
    socket.serverSends({
      kind: "event",
      channel: "voice:jarvis",
      event: { kind: "daemon-link", connected: true },
    });
    expect(link().isDaemonConnected.value).toBe(true);
    socket.serverDrops();
    expect(link().isDaemonConnected.value).toBe(false);
  });

  it("routes wake, speaking state and delegated speech", () => {
    const { link, onWake, socket } = mountLink();
    socket.serverAcks("voice:app");
    socket.serverSends({ kind: "event", channel: "voice:app", event: { kind: "wake", command: "open mail" } });
    expect(onWake).toHaveBeenCalledWith("open mail");
    socket.serverSends({ kind: "event", channel: "voice:app", event: { kind: "state", state: "speaking" } });
    expect(link().isDaemonSpeaking.value).toBe(true);
    socket.serverSends({ kind: "event", channel: "voice:app", event: { kind: "state", state: "idle" } });
    expect(link().isDaemonSpeaking.value).toBe(false);
    socket.serverSends({ kind: "event", channel: "voice:app", event: { kind: "speak", text: "good morning" } });
    expect(played).toEqual(["good morning"]);
  });

  it("skips relayed speech while this window's own overlay session is live", () => {
    // The daemon publishes every speak during a handoff (it cannot tell the
    // producers apart); the overlay already plays its own turn off its own
    // stream, so the relayed copy must not double-play.
    let ownTurnLive = true;
    const { socket } = mountLink("app", () => ownTurnLive);
    socket.serverAcks("voice:app");
    socket.serverSends({ kind: "event", channel: "voice:app", event: { kind: "speak", text: "own turn line" } });
    expect(played).toEqual([]);
    ownTurnLive = false;
    socket.serverSends({ kind: "event", channel: "voice:app", event: { kind: "speak", text: "scheduled line" } });
    expect(played).toEqual(["scheduled line"]);
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
