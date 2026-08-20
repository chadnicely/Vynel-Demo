// The room itself: its three columns, the slots P2 fills, the pills bound to
// the session, and the orb fed from the one derivation. The voice session is
// stubbed (happy-dom has no Web Speech and no microphone) — everything else
// runs for real, including the status composable over a quiet API.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { DisplayOrb, DisplayPanel } from "@vynel/ui";
import type { VynelClient } from "@vynel/sdk";
import type { LiveChannelServerFrame } from "@vynel/contracts/chat/live-channel";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useUiStore } from "../../stores/ui-store.js";
import {
  installFakeLiveSocket,
  latestFakeLiveSocket,
  type FakeLiveSocket,
} from "../../stores/live-channel-test-support.js";
import type { VoiceCommandSessionView } from "../../composables/voice/voice-command-session-types.js";
import type * as spokenAudioPlayerModule from "../../composables/voice/spoken-audio-player.js";
import DisplayView from "./DisplayView.vue";

interface VoiceStub {
  view: Ref<VoiceCommandSessionView>;
  failure: Ref<string | null>;
  isActive: Ref<boolean>;
  start: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  currentSessionId: ReturnType<typeof vi.fn>;
  speakExternal: ReturnType<typeof vi.fn>;
  /** The room's own `onEnded`, so a test can play the idle timer. */
  fireEnded: () => void;
}

const voice = vi.hoisted(() => ({}) as VoiceStub);

vi.mock("../../composables/voice/use-voice-session.js", async () => {
  const { computed, onUnmounted, ref } = await import("vue");
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
  voice.start = vi.fn(() => {
    voice.view.value = { state: "listening", transcript: "", spokenText: "", notice: "" };
  });
  voice.end = vi.fn(() => {
    voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  });
  // A relayed line is taken by the live session whenever a turn is in flight —
  // the room's default, so the side player is never reached in these tests.
  voice.currentSessionId = vi.fn(() => null);
  voice.speakExternal = vi.fn(() => true);
  // The real composable ends its session on unmount — mirrored here so the
  // stub keeps the same contract, which is what pins the session to the ROOM:
  // created in DisplayView's own setup, its life is the view's life.
  return {
    useVoiceSession: (options: { onEnded: () => void }) => {
      voice.fireEnded = options.onEnded;
      onUnmounted(() => voice.end());
      return voice;
    },
  };
});

// The daemon link's own player (the idle-room path for a relayed line) —
// stubbed so a test can hold a line "playing" and read the orb while it does.
// `observeSpokenSentenceStart` stays real: the orb's per-clause spike rides it.
const relayPlayback = vi.hoisted(() => ({ finish: null as null | (() => void) }));

vi.mock("../../composables/voice/spoken-audio-player.js", async (importOriginal) => {
  const actual = await importOriginal<typeof spokenAudioPlayerModule>();
  return {
    ...actual,
    createSpokenAudioPlayer: () => ({
      play: () =>
        new Promise<void>((resolve) => {
          relayPlayback.finish = resolve;
        }),
      cancel: () => relayPlayback.finish?.(),
    }),
  };
});

/** A machine at rest: everything the Display reads, answering empty. */
function quietClient(): VynelClient {
  return {
    dashboard: {
      getOverview: async () => ({
        workspaces: [],
        recentSessions: [],
        upcomingSchedules: [],
        openTasks: [],
        recentlyCompletedTasks: [],
      }),
    },
    workspaces: { listStatuses: async () => [] },
    approvals: { listPending: async () => [] },
    asks: { listPending: async () => [] },
    users: { getMe: async () => ({ displayName: "Chad", emailAddress: null }) },
    root: {
      getVoiceStatus: async () => ({ entry: null }),
      listDelegations: async () => ({ delegations: [] }),
    },
    chat: {
      getContinuing: async () => ({
        rootSessionId: null,
        currentSdkSessionId: null,
        lastMessageAt: null,
      }),
    },
    sessions: { overview: async () => [] },
  } as unknown as VynelClient;
}

/** POSTs the room makes on its own — only the daemon's session hand-back. */
let posted: Array<[string, RequestInit | undefined]>;

beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    posted.push([url, init]);
    return Promise.resolve({ ok: true } as Response);
  });
  // No socket unless a test wants one — the live channel goes "unavailable"
  // instead of dialing localhost and retrying for the whole run.
  vi.stubGlobal("WebSocket", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountDisplay(prepare?: (ui: ReturnType<typeof useUiStore>) => void) {
  voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  voice.failure.value = null;
  voice.start.mockClear();
  voice.end.mockClear();
  voice.speakExternal.mockClear();

  const pinia = createPinia();
  setActivePinia(pinia);
  prepare?.(useUiStore());

  const wrapper = mount(DisplayView, {
    global: {
      plugins: [
        pinia,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
      provide: { [vynelClientKey as symbol]: quietClient() },
    },
  });
  await flushPromises();
  return wrapper;
}

/** What idle silence does: the session settles and the view goes quiet. */
function idleTimeout(): void {
  voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  voice.fireEnded();
}

/** The channel this window's daemon link declared for itself. */
function voiceChannelOf(socket: FakeLiveSocket): string {
  return socket.sent
    .flatMap((message) => (message.op === "subscribe" ? message.channels : []))
    .find((channel) => channel.startsWith("voice:"))!;
}

function panelTitles(wrapper: Awaited<ReturnType<typeof mountDisplay>>): string[] {
  return wrapper.findAllComponents(DisplayPanel).map((panel) => panel.props("title"));
}

describe("DisplayView", () => {
  it("lays out the two columns around the stage", async () => {
    const wrapper = await mountDisplay();
    expect(wrapper.find('[data-testid="display-column-left"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="display-stage"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="display-column-right"]').exists()).toBe(true);
    expect(panelTitles(wrapper)).toEqual(["System", "Telemetry", "Account", "Legend"]);
  });

  // Empty on purpose (P2 fills them) — but named, so the room reads as
  // unfinished rather than broken.
  it("shows the three widget slots with the hint of what lands there", async () => {
    const wrapper = await mountDisplay();
    for (const slot of ["left", "stage", "right"]) {
      const placeholder = wrapper.find(`[data-testid="display-slot-${slot}"]`);
      expect(placeholder.exists()).toBe(true);
      expect(placeholder.text()).toBe("Claude can put reports here");
    }
  });

  it("reads the app's real status into the panels — quiet when the machine is", async () => {
    const wrapper = await mountDisplay();
    const system = wrapper.findAllComponents(DisplayPanel)[0]!;
    const rows = system.props("rows") as readonly { label: string; value: string }[];
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Link", "offline"],
      ["Working", "nothing running"],
      ["Voice", "quiet"],
      ["Rooms", "none yet"],
      ["Waiting", "nothing"],
    ]);
    const account = wrapper.findAllComponents(DisplayPanel)[2]!;
    expect((account.props("rows") as readonly { value: string }[])[0]!.value).toBe("Chad");
  });

  // The room's session is the ROOM'S: opening it takes the microphone, and
  // leaving by any route — the switch, a menu row, Home — gives it back,
  // because the session is created in this view's setup and dies with it.
  it("starts the session when the room opens and ends it when it closes", async () => {
    const wrapper = await mountDisplay();
    expect(voice.start).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(voice.end).toHaveBeenCalled();
  });

  it("the listening pill mirrors the mic and mutes it", async () => {
    const wrapper = await mountDisplay();
    const pill = wrapper.get('[data-testid="display-listening-pill"]');
    expect(pill.text()).toBe("Listening");

    await pill.trigger("click");
    expect(voice.end).toHaveBeenCalledTimes(1);
    expect(pill.text()).toBe("Muted");

    await pill.trigger("click");
    expect(voice.start).toHaveBeenCalledTimes(2);
    expect(pill.text()).toBe("Listening");
  });

  // Idle silence ends the session while the room stays open. Reading "Muted"
  // there is a lie — nobody muted it — and it cost a click: the first one
  // muted a session that was already dead.
  it("invites you back after idle silence instead of claiming it is muted", async () => {
    const wrapper = await mountDisplay();
    idleTimeout();
    await wrapper.vm.$nextTick();

    const pill = wrapper.get('[data-testid="display-listening-pill"]');
    expect(pill.text()).toBe("Resume");

    await pill.trigger("click");
    expect(voice.start).toHaveBeenCalledTimes(2);
    expect(pill.text()).toBe("Listening");
  });

  it("the voice pill hands the microphone back without leaving the room", async () => {
    const wrapper = await mountDisplay();
    const pill = wrapper.get('[data-testid="display-voice-pill"]');
    expect(pill.text()).toBe("Voice off");

    await pill.trigger("click");
    expect(voice.end).toHaveBeenCalledTimes(1);
    expect(pill.text()).toBe("Voice on");
    expect(wrapper.find('[data-testid="display-stage"]').exists()).toBe(true);

    await pill.trigger("click");
    expect(voice.start).toHaveBeenCalledTimes(2);
  });

  it("drives the orb from the session — listening through the reply, speaking with it", async () => {
    const wrapper = await mountDisplay();
    const orb = () => wrapper.getComponent(DisplayOrb);
    expect([orb().props("listening"), orb().props("speaking")]).toEqual([true, false]);

    voice.view.value = {
      state: "speaking",
      transcript: "what is up",
      spokenText: "All quiet.",
      notice: "",
    };
    await wrapper.vm.$nextTick();
    expect([orb().props("listening"), orb().props("speaking")]).toEqual([true, true]);
    // The reply so far is the caption — the same rule the voice stage uses.
    expect(wrapper.find(".caption").text()).toBe("All quiet.");
  });

  // happy-dom has no canvas 2D, so the renderer really does fail here — the
  // room must lose the orb and keep everything that carries the status.
  it("survives a machine the orb cannot draw on", async () => {
    const wrapper = await mountDisplay();
    const stage = wrapper.get('[data-testid="display-stage"]');
    expect(stage.text()).toContain("Orb unavailable");
    expect(panelTitles(wrapper)).toHaveLength(4);
  });

  it("a failure the user must act on takes the caption", async () => {
    const wrapper = await mountDisplay();
    voice.failure.value = "Voice recognition needs Chrome or Edge.";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".caption").text()).toBe("Voice recognition needs Chrome or Edge.");
  });
});

// Taking the overlay's session means taking its daemon link too: the overlay is
// the window's only `voice:app` subscriber, so while the room is up it is the
// room that answers the wake word and plays what other producers say.
describe("DisplayView — the daemon link", () => {
  it("plays a relayed line through the room's own session", async () => {
    const restoreSocket = installFakeLiveSocket();
    const wrapper = await mountDisplay();
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    const channel = voiceChannelOf(socket);
    socket.serverAcks(channel);

    socket.serverSends({
      kind: "event",
      channel,
      event: { kind: "speak", text: "your build is green", sessionId: "sched-1" },
    } as LiveChannelServerFrame);

    expect(voice.speakExternal).toHaveBeenCalledWith("your build is green");
    wrapper.unmount();
    restoreSocket();
  });

  // With no turn in flight the session declines and the link plays the line
  // itself — the assistant IS talking, so the orb has to say so. Nothing in
  // the session's own view moves for a line it never ran.
  it("lights the orb for a line it plays on the link's own player", async () => {
    voice.speakExternal.mockReturnValueOnce(false);
    const restoreSocket = installFakeLiveSocket();
    const wrapper = await mountDisplay();
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    const channel = voiceChannelOf(socket);
    socket.serverAcks(channel);
    expect(wrapper.getComponent(DisplayOrb).props("speaking")).toBe(false);

    socket.serverSends({
      kind: "event",
      channel,
      event: { kind: "speak", text: "lunch in five", sessionId: "sched-1" },
    } as LiveChannelServerFrame);
    await wrapper.vm.$nextTick();
    expect(wrapper.getComponent(DisplayOrb).props("speaking")).toBe(true);

    relayPlayback.finish!();
    await flushPromises();
    expect(wrapper.getComponent(DisplayOrb).props("speaking")).toBe(false);
    wrapper.unmount();
    restoreSocket();
  });

  it("gives the microphone back to the daemon when the session ends", async () => {
    await mountDisplay();
    expect(posted).toEqual([]);

    idleTimeout();

    expect(posted).toEqual([["/voice/session/end", { method: "POST" }]]);
  });
});

describe("DisplayView — the room owns the microphone", () => {
  // "Start voice" from the palette or the menu can't reach the room's session,
  // so the shell rings a bell and the room answers — no second orb behind it.
  it("answers 'Start voice' on its own session, and only when there is none", async () => {
    const wrapper = await mountDisplay();
    const ui = useUiStore();

    ui.requestDisplayVoice();
    await wrapper.vm.$nextTick();
    expect(voice.start).toHaveBeenCalledTimes(1);

    idleTimeout();
    await wrapper.vm.$nextTick();
    ui.requestDisplayVoice();
    await wrapper.vm.$nextTick();
    expect(voice.start).toHaveBeenCalledTimes(2);
  });

  // Opened from the palette and then handed the canvas, the overlay's switch
  // is left ON behind an overlay that is no longer mounted — nothing would
  // ever turn it off, and the shell keeps the page dimmed for it.
  it("clears the overlay's switch it inherited", async () => {
    await mountDisplay((ui) => {
      ui.isVoiceOverlayOpen = true;
    });
    expect(useUiStore().isVoiceOverlayOpen).toBe(false);
  });
});
