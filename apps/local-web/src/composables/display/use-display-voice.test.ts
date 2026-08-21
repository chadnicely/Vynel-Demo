// The window's Display voice: ONE session and ONE daemon link, held for as
// long as the window lives rather than as long as the room is on screen. What
// these cases pin is the ownership itself — who may start a recognizer, when
// the link is held, and what survives the room closing. The session composable
// is stubbed (happy-dom has no Web Speech and no microphone); the live channel
// is real over a fake socket.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, type Ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import type { VynelClient } from "@vynel/sdk";
import type { LiveChannelServerFrame } from "@vynel/contracts/chat/live-channel";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useUiStore } from "../../stores/ui-store.js";
import {
  installFakeLiveSocket,
  latestFakeLiveSocket,
  type FakeLiveSocket,
} from "../../stores/live-channel-test-support.js";
import type { VoiceCommandSessionView } from "../voice/voice-command-session-types.js";
import type { DisplaySessionAnnouncement } from "./use-display-session-announce.js";
import { useDisplayVoice } from "./use-display-voice.js";

interface VoiceStub {
  view: Ref<VoiceCommandSessionView>;
  failure: Ref<string | null>;
  isActive: Ref<boolean>;
  start: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  currentSessionId: ReturnType<typeof vi.fn>;
  speakExternal: ReturnType<typeof vi.fn>;
  /** The store's own `onEnded`, so a case can play the idle timer. */
  fireEnded: () => void;
}

const voice = vi.hoisted(() => ({}) as VoiceStub);

vi.mock("../voice/use-voice-session.js", async () => {
  const { computed, onScopeDispose, ref } = await import("vue");
  voice.view = ref<VoiceCommandSessionView>({
    state: "ended",
    transcript: "",
    spokenText: "",
    notice: "",
  });
  voice.failure = ref<string | null>(null);
  voice.isActive = computed(
    () => voice.view.value.state !== "ended",
  ) as unknown as Ref<boolean>;
  voice.start = vi.fn((command?: string) => {
    voice.view.value = {
      state: "listening",
      transcript: command ?? "",
      spokenText: "",
      notice: "",
    };
  });
  voice.end = vi.fn(() => {
    voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  });
  voice.currentSessionId = vi.fn(() => null);
  voice.speakExternal = vi.fn(() => true);
  return {
    useVoiceSession: (options: { onEnded: () => void }) => {
      voice.fireEnded = options.onEnded;
      onScopeDispose(() => voice.end());
      return voice;
    },
  };
});

let posted: Array<[string, RequestInit | undefined]>;
let announced: DisplaySessionAnnouncement[];
let restoreSocket: (() => void) | null = null;
let mounted: ReturnType<typeof mount> | null = null;

function announcingClient(sessions: DisplaySessionAnnouncement[]): VynelClient {
  return {
    voice: {
      setDisplaySession: async (announcement: DisplaySessionAnnouncement) => {
        sessions.push(announcement);
        return { published: false };
      },
    },
  } as unknown as VynelClient;
}

beforeEach(() => {
  posted = [];
  announced = [];
  voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  voice.failure.value = null;
  voice.start.mockClear();
  voice.end.mockClear();
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    posted.push([url, init]);
    return Promise.resolve({ ok: true } as Response);
  });
  restoreSocket = installFakeLiveSocket();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  restoreSocket?.();
  restoreSocket = null;
  vi.unstubAllGlobals();
});

/** A host with the shape the shell has: it creates the store and goes away
 *  without taking it with it. */
function mountVoice() {
  const pinia = createPinia();
  let store!: ReturnType<typeof useDisplayVoice>;
  const wrapper = mount(
    defineComponent({
      setup() {
        store = useDisplayVoice();
        return () => h("div");
      },
    }),
    {
      global: {
        plugins: [pinia],
        provide: { [vynelClientKey as symbol]: announcingClient(announced) },
      },
    },
  );
  mounted = wrapper;
  return { wrapper, store, ui: useUiStore(pinia) };
}

/** Every channel this window subscribed / unsubscribed, in order. */
function voiceTraffic(socket: FakeLiveSocket): string[] {
  return socket.sent.flatMap((message) =>
    message.op === "subscribe" || message.op === "unsubscribe"
      ? message.channels
          .filter((channel) => channel.startsWith("voice:"))
          .map((channel) => `${message.op} ${channel}`)
      : [],
  );
}

/** The daemon's own phase, as the relay carries it. */
function daemonSays(socket: FakeLiveSocket, channel: string, state: string): void {
  socket.serverSends({
    kind: "event",
    channel,
    event: { kind: "state", state },
  } as LiveChannelServerFrame);
}

function openChannel(): { socket: FakeLiveSocket; channel: string } {
  const socket = latestFakeLiveSocket();
  socket.serverOpens();
  const channel = socket.sent
    .flatMap((message) => (message.op === "subscribe" ? message.channels : []))
    .find((name) => name.startsWith("voice:"))!;
  socket.serverAcks(channel);
  return { socket, channel };
}

describe("useDisplayVoice — who holds the microphone", () => {
  // The link is the other half of "exactly one voice per window": while the
  // Display does not own it, `VoiceOverlay` is mounted and holds it instead.
  it("takes the daemon link only while the Display owns the window's voice", () => {
    const { store } = mountVoice();
    store.setRoomOnScreen(true);
    const { socket } = openChannel();
    expect(voiceTraffic(socket)).toEqual(["subscribe voice:app"]);

    // Voice on, then the user walks away from the room: the conversation is
    // still ours, so the link stays exactly where it is.
    store.start();
    store.setRoomOnScreen(false);
    expect(voiceTraffic(socket)).toEqual(["subscribe voice:app"]);

    // Voice off with the room gone too — nothing left to hold it for.
    store.end();
    expect(voiceTraffic(socket)).toEqual([
      "subscribe voice:app",
      "unsubscribe voice:app",
    ]);
  });

  // The room needs the link with voice OFF as well, or a wake would land
  // nowhere while the user sits looking at the orb.
  it("holds the link for a room with the voice switched off", () => {
    const { store } = mountVoice();
    store.setRoomOnScreen(true);
    const { socket } = openChannel();
    expect(store.isLive).toBe(false);
    expect(voiceTraffic(socket)).toEqual(["subscribe voice:app"]);
  });

  it("survives the host that created it", async () => {
    const { wrapper, store } = mountVoice();
    store.start();
    expect(store.isActive).toBe(true);

    wrapper.unmount();
    mounted = null;
    await flushPromises();

    expect(voice.end).not.toHaveBeenCalled();
    expect(store.isLive).toBe(true);
    expect(store.isActive).toBe(true);
  });
});

describe("useDisplayVoice — the switch", () => {
  it("start takes the microphone from the overlay and never opens a second session", () => {
    const { store, ui } = mountVoice();
    ui.isVoiceOverlayOpen = true;

    store.start();
    expect(ui.isVoiceOverlayOpen).toBe(false);
    expect(store.isLive).toBe(true);
    expect(voice.start).toHaveBeenCalledTimes(1);

    store.start();
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  it("end gives the microphone back from wherever the user is", () => {
    const { store } = mountVoice();
    store.start();
    store.end();
    expect(store.isLive).toBe(false);
    expect(store.isMuted).toBe(false);
    expect(voice.end).toHaveBeenCalledTimes(1);
  });

  // Idle silence is a pause in the conversation, not a hang-up: the switch
  // stays on (so the overlay stays out of the way and the wake word still
  // lands here) while the daemon gets the microphone back.
  it("keeps the voice on through idle silence, and hands the mic to the daemon", () => {
    const { store } = mountVoice();
    store.start();

    voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
    voice.fireEnded();

    expect(store.isLive).toBe(true);
    expect(store.isActive).toBe(false);
    expect(posted).toEqual([["/voice/session/end", { method: "POST" }]]);
  });

  it("mute pauses the session and unmute takes it back", () => {
    const { store } = mountVoice();
    store.start();

    store.toggleMute();
    expect(store.isMuted).toBe(true);
    expect(voice.end).toHaveBeenCalledTimes(1);
    expect(store.isLive).toBe(true);

    store.toggleMute();
    expect(store.isMuted).toBe(false);
    expect(voice.start).toHaveBeenCalledTimes(2);
  });

  // The real `end()` is ASYNC — it aborts capture and the session's own loop
  // publishes `ended` a tick later — so a fast second click lands while the
  // recognizer is still winding down. Unmuting there must still leave the
  // conversation un-muted and on, never wedged mid-way.
  it("unmutes cleanly while the recognizer is still winding down", () => {
    const { store } = mountVoice();
    store.start();

    // Mute, WITHOUT the view settling: the old session is still `isActive`.
    store.toggleMute();
    voice.view.value = { state: "listening", transcript: "", spokenText: "", notice: "" };
    expect(store.isMuted).toBe(true);
    expect(store.isActive).toBe(true);

    store.toggleMute();
    expect(store.isMuted).toBe(false);
    expect(store.isLive).toBe(true);

    // It settles; the room offers to resume, and that click opens a recognizer.
    voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
    voice.fireEnded();
    expect(store.isMuted).toBe(false);
    store.toggleMute();
    expect(store.isActive).toBe(true);
  });

  // Muting what is already silent would leave the room's two pills
  // contradicting each other and cost the user a second click.
  it("restarts rather than mutes a session the idle timer already ended", () => {
    const { store } = mountVoice();
    store.start();
    voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
    voice.fireEnded();

    store.toggleMute();
    expect(store.isMuted).toBe(false);
    expect(store.isActive).toBe(true);
  });
});

describe("useDisplayVoice — the daemon's frames", () => {
  // The invariant: a recognizer only ever runs behind `isLive`. A wake that
  // started one directly would be released mid-sentence the moment the user
  // left the room, and `VoiceOverlay` would remount over the top of it.
  it("answers a wake through the switch, so the session is never orphaned", () => {
    const { store } = mountVoice();
    store.setRoomOnScreen(true);
    const { socket, channel } = openChannel();

    socket.serverSends({
      kind: "event",
      channel,
      event: { kind: "wake", command: "what is up" },
    } as LiveChannelServerFrame);

    expect(store.isLive).toBe(true);
    expect(voice.start).toHaveBeenCalledWith("what is up", undefined);

    // Walking away now keeps the conversation and the link that carries it.
    store.setRoomOnScreen(false);
    expect(voiceTraffic(socket)).toEqual(["subscribe voice:app"]);
  });

  // The hand-over is honest: a Web Speech session cannot move between windows,
  // so while the dock holds the wake conversation the room REPORTS it. A second
  // recognizer here would talk straight over it.
  it("refuses the microphone while the other leg holds the conversation", () => {
    const { store } = mountVoice();
    store.setRoomOnScreen(true);
    const { socket, channel } = openChannel();
    daemonSays(socket, channel, "handed-off");

    expect(store.isVoiceHeldElsewhere).toBe(true);
    store.start();
    expect(voice.start).not.toHaveBeenCalled();
    expect(store.isLive).toBe(false);

    // The mic pill is the same door — including the unmute branch, which used
    // to reach `voice.start()` directly.
    store.toggleMute();
    expect(voice.start).not.toHaveBeenCalled();

    // The dock gave it back: the room may take the microphone again.
    daemonSays(socket, channel, "idle");
    expect(store.isVoiceHeldElsewhere).toBe(false);
    store.start();
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  // The gate exists to keep the room off SOMEBODY ELSE's conversation. When the
  // daemon hands the wake to this very window it publishes `wake` first, so a
  // gate on the daemon's phase alone would swallow the wake it just delivered.
  it("still answers a wake handed to this window, daemon phase and all", () => {
    const { store } = mountVoice();
    store.setRoomOnScreen(true);
    const { socket, channel } = openChannel();
    daemonSays(socket, channel, "wake");

    socket.serverSends({
      kind: "event",
      channel,
      event: { kind: "wake", command: "what is up" },
    } as LiveChannelServerFrame);

    expect(voice.start).toHaveBeenCalledWith("what is up", undefined);
    expect(store.isLive).toBe(true);
    // Our own session, so the room says "Listening", not "Dock is listening".
    expect(store.isVoiceHeldElsewhere).toBe(false);
  });

  // The store cannot open the room — that is the switch's job — so it rings.
  it("rings for the room when the daemon asks the app to come forward", () => {
    const { store } = mountVoice();
    store.setRoomOnScreen(true);
    const { socket, channel } = openChannel();
    expect(store.showDisplayRequestCount).toBe(0);

    socket.serverSends({
      kind: "event",
      channel,
      event: { kind: "show-display" },
    } as LiveChannelServerFrame);

    expect(store.showDisplayRequestCount).toBe(1);
  });
});

describe("useDisplayVoice — the dock's mirror", () => {
  it("announces the conversation from the window, with no room involved", async () => {
    const { store } = mountVoice();
    await flushPromises();
    // Nothing to mirror yet — and the dock hears that as soon as the window
    // has a voice at all, not only once someone opens the room.
    expect(announced.at(-1)).toMatchObject({ live: false, phase: "idle" });

    store.start();
    await flushPromises();
    expect(announced.at(-1)).toEqual({
      live: true,
      phase: "listening",
      caption: "Listening…",
    });

    store.end();
    await flushPromises();
    expect(announced.at(-1)).toMatchObject({ live: false, phase: "idle" });
  });

  // Muted is the one state where the recognizer is already stopped, so ending
  // moves nothing in the session's own view — the dock would keep a paused
  // conversation on screen forever if the mute itself did not carry liveness.
  it("takes the mirror down when a MUTED conversation is ended", async () => {
    const { store } = mountVoice();
    store.start();
    store.toggleMute();
    await flushPromises();
    expect(announced.at(-1)).toMatchObject({ live: true, phase: "muted" });

    store.end();
    await flushPromises();
    expect(announced.at(-1)).toMatchObject({ live: false });
  });
});
