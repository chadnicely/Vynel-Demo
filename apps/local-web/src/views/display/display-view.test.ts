// The room itself: its three columns, the slots P2 fills, the pills bound to
// the session, and the orb fed from the one derivation. The voice session is
// stubbed (happy-dom has no Web Speech and no microphone) — everything else
// runs for real, including the status composable over a quiet API.
//
// The session is NOT the room's any more (2026-08-21): it belongs to the
// window (`use-display-voice`), so these cases open the room over a session
// that already exists and check what the room DRAWS — including the room
// closing and the conversation carrying on without it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaybeRefOrGetter, Ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { DisplayOrb, DisplayPanel } from "@vynel/ui";
import type { VynelClient } from "@vynel/sdk";
import type { LiveChannelServerFrame } from "@vynel/contracts/chat/live-channel";
import type { DisplayWidgetView } from "@vynel/contracts/display/display-widget";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import type { DisplayBoardChange } from "../../composables/display/use-display-widgets.js";
import type { DisplaySessionAnnouncement } from "../../composables/display/use-display-session-announce.js";
import { useDisplayVoice } from "../../composables/display/use-display-voice.js";
import type { SessionScope } from "../../composables/chat/session-scope.js";
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
  // The real composable ends its session when its OWNER'S scope goes away —
  // mirrored here so the stub keeps the same contract. Its owner is the
  // window-lifetime store now, which is why closing the room ends nothing.
  return {
    useVoiceSession: (options: { onEnded: () => void }) => {
      voice.fireEnded = options.onEnded;
      onScopeDispose(() => voice.end());
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

/** The board, faked. What these cases are about is the view's CONTRACT with
 *  `use-display-widgets`: which slot a card lands in, what Clear calls, and
 *  that the log rides the composable's own frame tap rather than a second
 *  `display` subscription. The composable itself is tested over a real socket
 *  next door in `use-display-widgets.test.ts`. */
interface BoardStub {
  widgets: Ref<DisplayWidgetView[]>;
  clearOnServer: ReturnType<typeof vi.fn>;
  /** The scope the room asked for. */
  scope: string | null;
  /** The room's own `onChange`, so a case can play a live frame arriving. */
  notify: (change: DisplayBoardChange) => void;
}

const board = vi.hoisted(() => ({}) as BoardStub);

vi.mock("../../composables/display/use-display-widgets.js", async () => {
  const { computed, ref, toValue } = await import("vue");
  board.widgets = ref<DisplayWidgetView[]>([]);
  board.clearOnServer = vi.fn(async () => {});
  board.scope = null;
  const inSlot = (slot: string) =>
    board.widgets.value.filter((widget) => widget.slot === slot);
  return {
    useDisplayWidgets: (
      scope: MaybeRefOrGetter<string>,
      options?: { onChange?: (change: DisplayBoardChange) => void },
    ) => {
      board.scope = toValue(scope);
      board.notify = (change) => options?.onChange?.(change);
      return {
        widgets: computed(() => board.widgets.value),
        bySlot: computed(() => ({
          left: inSlot("left"),
          stage: inSlot("stage"),
          right: inSlot("right"),
          dock: inSlot("dock"),
        })),
        isLoading: ref(false),
        clear: vi.fn(),
        clearOnServer: board.clearOnServer,
      };
    },
  };
});

function makeWidget(
  id: string,
  overrides: Partial<DisplayWidgetView> = {},
): DisplayWidgetView {
  return {
    id,
    scopeKey: "global",
    title: id,
    kind: "metric",
    content: { kind: "metric", value: "12", label: "Runs" },
    slot: "stage",
    size: "md",
    sortOrder: 1,
    createdBySessionId: null,
    expiresAt: null,
    createdAt: "2026-08-21T09:00:00.000Z",
    updatedAt: "2026-08-21T09:00:00.000Z",
    ...overrides,
  };
}

/** A machine at rest: everything the Display reads, answering empty.
 *  `sessions` is captured per mount on purpose — the voice stub is a module
 *  singleton, so a store left behind by an earlier case still watches it, and
 *  a shared array would let that ghost announce into this case's expectations. */
function quietClient(sessions: DisplaySessionAnnouncement[]): VynelClient {
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
    // The window announces the conversation it holds so the display dock
    // (another window) can mirror it — every phase change, room or no room.
    voice: {
      setDisplaySession: async (announcement: DisplaySessionAnnouncement) => {
        sessions.push(announcement);
        return { published: false };
      },
    },
  } as unknown as VynelClient;
}

/** POSTs made on this window's behalf — only the daemon's session hand-back. */
let posted: Array<[string, RequestInit | undefined]>;
/** Every `setDisplaySession` this window announced, in order — what the display
 *  dock mirrors while the user is looking somewhere else. */
let announcedSessions: DisplaySessionAnnouncement[];
/** The window's voice, as the shell would hold it. */
let displayVoice: ReturnType<typeof useDisplayVoice>;
/** Kept so a second mount can re-open the room over the SAME window voice. */
let windowPinia: Pinia;
let mounted: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  posted = [];
  announcedSessions = [];
  board.widgets.value = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    posted.push([url, init]);
    return Promise.resolve({ ok: true } as Response);
  });
  // No socket unless a test wants one — the live channel goes "unavailable"
  // instead of dialing localhost and retrying for the whole run.
  vi.stubGlobal("WebSocket", undefined);
});

// One room at a time: the voice stub is a module singleton, so a view left
// mounted by an earlier case would answer this one's session changes too.
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

interface MountOptions {
  prepare?: (ui: ReturnType<typeof useUiStore>) => void;
  scope?: SessionScope;
  /** Whether the window's voice is already on when the room opens — what the
   *  title-bar switch does, and the state the room is normally reached in. */
  voiceOn?: boolean;
}

async function mountDisplay(options: MountOptions = {}) {
  const { prepare, scope = { kind: "global" }, voiceOn = true } = options;
  voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  voice.failure.value = null;
  voice.start.mockClear();
  voice.end.mockClear();
  voice.speakExternal.mockClear();
  board.clearOnServer.mockClear();
  announcedSessions = [];

  const pinia = createPinia();
  windowPinia = pinia;
  setActivePinia(pinia);
  prepare?.(useUiStore());

  const wrapper = mount(DisplayView, {
    props: { scope },
    global: {
      plugins: [
        pinia,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
      provide: { [vynelClientKey as symbol]: quietClient(announcedSessions) },
    },
  });
  mounted = wrapper;
  // The shell's switch is the one reading of "the room is on screen" — with no
  // shell here, this case stands in for it. Without it the window would not
  // hold the daemon link the room draws its other leg from.
  displayVoice = useDisplayVoice();
  displayVoice.setRoomOnScreen(true);
  if (voiceOn) displayVoice.start();
  await flushPromises();
  return wrapper;
}

/** Re-open the room over the SAME window voice — what coming back to the
 *  Display does. */
async function remountDisplay() {
  mounted?.unmount();
  const wrapper = mount(DisplayView, {
    props: { scope: { kind: "global" } as SessionScope },
    global: {
      plugins: [
        windowPinia,
        [VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }],
      ],
      provide: { [vynelClientKey as symbol]: quietClient(announcedSessions) },
    },
  });
  mounted = wrapper;
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

  // An empty board still names its three regions, so the room reads as ready
  // rather than broken.
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

  // The room is a SCREEN, not the conversation. It opens over whatever the
  // window's voice is doing and starts nothing of its own — the switch did
  // that — so a room opened with voice off shows an idle orb and an invitation.
  it("starts no session of its own", async () => {
    await mountDisplay({ voiceOn: false });
    expect(voice.start).not.toHaveBeenCalled();
    expect(displayVoice.isLive).toBe(false);
  });

  // The whole point of the change: walking away from the Display used to hang
  // up the call, which put the dock's mirror — the corner form of this very
  // room — permanently out of reach.
  it("leaves the conversation running when the room closes, and re-attaches to it", async () => {
    const wrapper = await mountDisplay();
    expect(voice.start).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(voice.end).not.toHaveBeenCalled();
    expect(displayVoice.isLive).toBe(true);
    expect(displayVoice.isActive).toBe(true);

    // Coming back re-attaches to the same session rather than opening a second.
    const again = await remountDisplay();
    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(again.get('[data-testid="display-listening-pill"]').text()).toBe("Listening");
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
    expect(displayVoice.isLive).toBe(false);
    expect(pill.text()).toBe("Voice on");
    expect(wrapper.find('[data-testid="display-stage"]').exists()).toBe(true);

    await pill.trigger("click");
    expect(voice.start).toHaveBeenCalledTimes(2);
    expect(displayVoice.isLive).toBe(true);
  });

  // Voice off is its OWN state: there is nothing to mute and nothing to
  // resume, so the mic pill offers to start one — the room stays a place you
  // can sit in quietly.
  it("offers to start the conversation when the window's voice is off", async () => {
    const wrapper = await mountDisplay({ voiceOn: false });
    const pill = wrapper.get('[data-testid="display-listening-pill"]');
    expect(pill.text()).toBe("Start");
    expect(wrapper.get('[data-testid="display-voice-pill"]').text()).toBe("Voice on");

    await pill.trigger("click");
    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(displayVoice.isLive).toBe(true);
    expect(pill.text()).toBe("Listening");
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

// The window's voice holds the `voice:app` link whenever the Display owns the
// microphone — the room on screen is one of the two ways that happens — so
// while the room is up it is this leg that answers the wake word and plays what
// other producers say, and the room draws it.
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

  // A wake answered on the DAEMON's leg — natively, or handed to the wake
  // window while this room stayed open. The conversation is the assistant's
  // either way, so the room's orb mirrors it — but only once the room's own
  // microphone is out of the way. Two legs, never two "listening" sources.
  it("mirrors the daemon's conversation once the room's own session lets go", async () => {
    const restoreSocket = installFakeLiveSocket();
    const wrapper = await mountDisplay();
    const socket = latestFakeLiveSocket();
    socket.serverOpens();
    const channel = voiceChannelOf(socket);
    socket.serverAcks(channel);
    const orb = () => wrapper.getComponent(DisplayOrb);
    const daemonState = (state: string) =>
      socket.serverSends({ kind: "event", channel, event: { kind: "state", state } } as LiveChannelServerFrame);

    // The room's own session, with a quiet daemon behind it.
    expect([orb().props("listening"), orb().props("speaking")]).toEqual([true, false]);

    // Idle silence ends it — with neither leg live the orb goes deaf.
    idleTimeout();
    await wrapper.vm.$nextTick();
    expect(orb().props("listening")).toBe(false);

    // The daemon takes the conversation: the room's orb mirrors it anyway.
    daemonState("listening");
    await wrapper.vm.$nextTick();
    expect([orb().props("listening"), orb().props("speaking")]).toEqual([true, false]);

    daemonState("speaking");
    await wrapper.vm.$nextTick();
    expect([orb().props("listening"), orb().props("speaking")]).toEqual([true, true]);

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

// The display dock is this room in another window, and cannot see this screen.
// A Web Speech session cannot move between windows either — so the WINDOW says
// what it is holding and the dock MIRRORS it in the corner. It rides the
// window, not the room: mirroring a conversation you have walked away from is
// the entire reason the dock exists.
describe("DisplayView — announcing the conversation to the dock", () => {
  it("announces the phase the moment it changes, and keeps going without the room", async () => {
    const wrapper = await mountDisplay();
    await flushPromises();
    expect(announcedSessions.at(-1)).toEqual({
      live: true,
      phase: "listening",
      caption: "Listening…",
    });

    voice.view.value = { state: "thinking", transcript: "", spokenText: "", notice: "" };
    await flushPromises();
    expect(announcedSessions.at(-1)).toMatchObject({ live: true, phase: "thinking" });

    // The room closes; the conversation — and the corner row showing it — does not.
    wrapper.unmount();
    voice.view.value = { state: "speaking", transcript: "", spokenText: "All quiet.", notice: "" };
    await flushPromises();
    expect(announcedSessions.at(-1)).toMatchObject({
      live: true,
      phase: "speaking",
      caption: "All quiet.",
    });
  });

  // Muted is a PAUSED conversation, not an ended one — the corner row says so
  // rather than disappearing and stranding the user's own mute.
  it("keeps a muted room live, and reports it as muted", async () => {
    const wrapper = await mountDisplay();
    await wrapper.find("[data-testid='display-listening-pill']").trigger("click");
    await flushPromises();
    expect(announcedSessions.at(-1)).toEqual({
      live: true,
      phase: "muted",
      caption: "Muted — Vynel isn't listening",
    });
  });

  it("says the conversation is over when the idle timer ends it", async () => {
    await mountDisplay();
    idleTimeout();
    await flushPromises();
    expect(announcedSessions.at(-1)).toMatchObject({ live: false, phase: "idle" });
  });
});

describe("DisplayView — the board", () => {
  /** What one region holds, by title. */
  function titlesIn(
    wrapper: Awaited<ReturnType<typeof mountDisplay>>,
    slot: string,
  ): string[] {
    return wrapper
      .get(`[data-testid="display-widgets-${slot}"]`)
      .findAll(".title")
      .map((title) => title.text());
  }

  function telemetryValues(
    wrapper: Awaited<ReturnType<typeof mountDisplay>>,
  ): string[] {
    const panel = wrapper
      .findAllComponents(DisplayPanel)
      .find((candidate) => candidate.props("title") === "Telemetry")!;
    return (panel.props("rows") as readonly { value: string }[]).map(
      (row) => row.value,
    );
  }

  // The surface decides the scope: the same room reads a different board
  // depending on where it was opened, named exactly as the tools name it.
  it("reads the board of the surface it was opened on", async () => {
    await mountDisplay();
    expect(board.scope).toBe("global");

    await mountDisplay({ scope: { kind: "workspace", workspaceId: "ws-7" } });
    expect(board.scope).toBe("ws-7");
  });

  // One machine, one microphone — a workspace room draws the window's existing
  // conversation rather than opening a second one beside the global room's.
  it("opens no session of its own for a workspace board", async () => {
    const wrapper = await mountDisplay({
      scope: { kind: "workspace", workspaceId: "ws-7" },
    });
    // Once, by the switch this case stands in for — never again by the room.
    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="display-listening-pill"]').text()).toBe("Listening");
  });

  it("puts every widget in the slot it belongs to", async () => {
    board.widgets.value = [
      makeWidget("left-card", { slot: "left", title: "Open tasks" }),
      makeWidget("stage-card", { slot: "stage", title: "This week" }),
      makeWidget("right-card", { slot: "right", title: "Spend" }),
      // The dock is P3: typed, carried, and deliberately not drawn.
      makeWidget("dock-card", { slot: "dock", title: "Later" }),
    ];

    const wrapper = await mountDisplay();

    expect(titlesIn(wrapper, "left")).toEqual(["Open tasks"]);
    expect(titlesIn(wrapper, "stage")).toEqual(["This week"]);
    expect(titlesIn(wrapper, "right")).toEqual(["Spend"]);
    expect(wrapper.text()).not.toContain("Later");
  });

  it("keeps the hint only where the slot is still empty", async () => {
    board.widgets.value = [makeWidget("stage-card", { slot: "stage" })];

    const wrapper = await mountDisplay();

    expect(wrapper.find('[data-testid="display-slot-stage"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="display-slot-left"]').text()).toBe(
      "Claude can put reports here",
    );
    expect(wrapper.find('[data-testid="display-slot-right"]').exists()).toBe(true);
  });

  it("offers Clear only with something to clear, and clears the scope for real", async () => {
    const empty = await mountDisplay();
    expect(empty.find('[data-testid="display-clear"]').exists()).toBe(false);

    board.widgets.value = [makeWidget("stage-card")];
    const wrapper = await mountDisplay();

    await wrapper.get('[data-testid="display-clear"]').trigger("click");
    await flushPromises();

    expect(board.clearOnServer).toHaveBeenCalledTimes(1);
  });

  // Clearing blanks the board optimistically, so by the time the POST fails
  // the board is already empty — the pill has to outlive that, or the failure
  // would look exactly like a success.
  it("says so on the pill when clearing failed, rather than pretending", async () => {
    board.widgets.value = [makeWidget("stage-card")];
    board.clearOnServer.mockImplementationOnce(async () => {
      board.widgets.value = [];
      throw new Error("offline");
    });
    const wrapper = await mountDisplay();

    await wrapper.get('[data-testid="display-clear"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="display-clear"]').text()).toBe("Clear failed");
  });

  it("logs one telemetry line per board change, off the room's one subscription", async () => {
    const wrapper = await mountDisplay();
    expect(telemetryValues(wrapper)).toEqual([]);

    board.notify({ kind: "added", title: "This week" });
    board.notify({ kind: "removed", title: "This week" });
    board.notify({ kind: "cleared", title: null });
    await wrapper.vm.$nextTick();

    expect(telemetryValues(wrapper)).toEqual([
      "widget added · This week",
      "widget removed · This week",
      "display cleared",
    ]);
  });
});
