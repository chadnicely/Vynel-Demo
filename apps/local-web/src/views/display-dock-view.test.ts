// The dock's two shapes and the window that follows them: a wake conversation
// in the middle of the screen, a mini row in the corner once the app's Display
// has had the conversation, and nothing at all while the room is on screen.
// The voice session + daemon link are stubbed (happy-dom has no microphone);
// the mode derivation itself runs for real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { DisplayWidgetView } from "@vynel/contracts/display/display-widget";
import type { DisplayWidgetContent } from "@vynel/contracts/display/display-widget-content";
import type { VoiceCommandSessionView } from "../composables/voice/voice-command-session-types.js";
import type { AppDisplaySession } from "../composables/voice/use-voice-daemon-link.js";
import type * as overlayWindowModule from "../composables/voice/tauri-overlay-window.js";
import type { OverlayLayout } from "../composables/voice/tauri-overlay-window.js";
import VoiceStage from "../components/voice/VoiceStage.vue";
import DisplayDockView from "./DisplayDockView.vue";

interface VoiceStub {
  view: Ref<VoiceCommandSessionView>;
  failure: Ref<string | null>;
  isActive: Ref<boolean>;
  start: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  currentSessionId: ReturnType<typeof vi.fn>;
  speakExternal: ReturnType<typeof vi.fn>;
  /** The view's own `onEnded` — the idle timer, played by hand. */
  fireEnded: () => void;
}

const voice = vi.hoisted(() => ({}) as VoiceStub);

vi.mock("../composables/voice/use-voice-session.js", async () => {
  const { computed, ref: makeRef } = await import("vue");
  voice.view = makeRef<VoiceCommandSessionView>({
    state: "ended",
    transcript: "",
    spokenText: "",
    notice: "",
  });
  voice.failure = makeRef<string | null>(null);
  voice.isActive = computed(
    () => voice.view.value.state !== "ended",
  ) as unknown as Ref<boolean>;
  voice.start = vi.fn(() => {
    voice.view.value = {
      state: "speaking",
      transcript: "",
      spokenText: "Two builds are green",
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
      return voice;
    },
  };
});

interface DaemonStub {
  isAppDisplayActive: Ref<boolean>;
  appDisplaySession: Ref<AppDisplaySession | null>;
  notifySessionEnd: ReturnType<typeof vi.fn>;
  /** The daemon heard the wake word. */
  wake: () => void;
}

const daemon = vi.hoisted(() => ({}) as DaemonStub);

// P3b's contract, standing in for the real link: `isAppDisplayActive` rides a
// `display-active` frame from the app window, `appDisplaySession` a
// `display-session` one.
vi.mock("../composables/voice/use-voice-daemon-link.js", async () => {
  const { ref: makeRef } = await import("vue");
  daemon.isAppDisplayActive = makeRef(false);
  daemon.appDisplaySession = makeRef<AppDisplaySession | null>(null);
  daemon.notifySessionEnd = vi.fn();
  return {
    useVoiceDaemonLink: (options: { onWake: (command: string) => void }) => {
      daemon.wake = () => options.onWake("");
      return {
        isDaemonConnected: makeRef(true),
        daemonState: makeRef("idle"),
        isDaemonSpeaking: makeRef(false),
        isPlayingRelayedLine: makeRef(false),
        isAppDisplayActive: daemon.isAppDisplayActive,
        appDisplaySession: daemon.appDisplaySession,
        notifySessionEnd: daemon.notifySessionEnd,
      };
    },
  };
});

const board = vi.hoisted(() => ({ dock: [] as DisplayWidgetView[], scope: "" }));

vi.mock("../composables/display/use-display-widgets.js", async () => {
  const { computed, toValue } = await import("vue");
  return {
    useDisplayWidgets: (scope: string) => {
      board.scope = toValue(scope);
      return {
        widgets: computed(() => board.dock),
        bySlot: computed(() => ({ left: [], stage: [], right: [], dock: board.dock })),
        isLoading: { value: false },
        clear: vi.fn(),
        clearOnServer: vi.fn(),
      };
    },
  };
});

// The dock's own activity subscription — its rule is tested next door in
// use-display-dock-mode.test.ts; here it must simply not open a socket.
vi.mock("../composables/activity/use-session-activity-feed.js", () => ({
  useSessionActivityFeed: () => {},
}));

const overlay = vi.hoisted(() => ({
  layouts: [] as OverlayLayout[],
  reveal: vi.fn(),
  dismiss: vi.fn(),
  hide: vi.fn(),
  park: vi.fn(),
}));

vi.mock("../composables/voice/tauri-overlay-window.js", async (importOriginal) => {
  const actual = await importOriginal<typeof overlayWindowModule>();
  return {
    ...actual,
    createOverlayWindowControls: () => ({
      isTauri: true,
      reveal: overlay.reveal,
      dismiss: overlay.dismiss,
      hide: overlay.hide,
      park: overlay.park,
      applyLayout: (layout: OverlayLayout) => overlay.layouts.push(layout),
    }),
  };
});

function widget(id: string, content: DisplayWidgetContent): DisplayWidgetView {
  return {
    id,
    scopeKey: "global",
    title: `${id} title`,
    kind: content.kind,
    content,
    slot: "dock",
    size: "sm",
    sortOrder: 1,
    createdBySessionId: null,
    expiresAt: null,
    createdAt: "2026-08-21T09:00:00.000Z",
    updatedAt: "2026-08-21T09:00:00.000Z",
  };
}

// One dock at a time: the stubs above are module singletons, so a view left
// mounted by an earlier case would answer the next case's wake too.
let mounted: ReturnType<typeof mount> | null = null;

async function mountDock() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(DisplayDockView, { global: { plugins: [pinia] } });
  mounted = wrapper;
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

beforeEach(() => {
  voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  voice.failure.value = null;
  voice.start.mockClear();
  voice.end.mockClear();
  daemon.isAppDisplayActive.value = false;
  daemon.appDisplaySession.value = null;
  board.dock = [];
  overlay.layouts.length = 0;
  overlay.reveal.mockClear();
  overlay.dismiss.mockClear();
  overlay.hide.mockClear();
  overlay.park.mockClear();
});

describe("DisplayDockView", () => {
  it("shows nothing until a wake lands, and never closes itself first", async () => {
    const wrapper = await mountDock();
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(false);
    // The daemon replays an undelivered wake into a window it just launched —
    // a dock that dismissed itself on mount would swallow it.
    expect(overlay.dismiss).not.toHaveBeenCalled();
    expect(overlay.reveal).not.toHaveBeenCalled();
  });

  it("takes the middle of the screen for the wake conversation", async () => {
    const wrapper = await mountDock();
    daemon.wake();
    await flushPromises();

    expect(voice.start).toHaveBeenCalled();
    expect(wrapper.find("[data-testid='display-dock-stage']").exists()).toBe(true);
    // The user just said the wake word — the keyboard is theirs to give.
    expect(overlay.reveal).toHaveBeenCalledWith({ focus: true });
    expect(overlay.layouts.at(-1)).toEqual({ park: "center", width: 420, height: 560 });
  });

  it("steps aside — never closes — while the app's Display has the room", async () => {
    const wrapper = await mountDock();
    daemon.wake();
    await flushPromises();

    daemon.isAppDisplayActive.value = true;
    await flushPromises();

    expect(overlay.hide).toHaveBeenCalledTimes(1);
    // Closing is what the Chrome fallback does on dismiss — it would take the
    // live session with it.
    expect(overlay.dismiss).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(false);
  });

  it("comes back as a mini row with the caption and the dock board", async () => {
    board.dock = [
      widget("w1", { kind: "metric", value: "3", label: "Open" }),
      widget("w2", { kind: "table", columns: ["a"], rows: [["1"]] }),
    ];
    const wrapper = await mountDock();
    expect(board.scope).toBe("global");

    daemon.wake();
    daemon.isAppDisplayActive.value = true;
    await flushPromises();
    daemon.isAppDisplayActive.value = false;
    await flushPromises();

    const mini = wrapper.find("[data-testid='display-dock-mini']");
    expect(mini.exists()).toBe(true);
    expect(wrapper.find("[data-testid='display-dock-caption']").text()).toBe(
      "Two builds are green",
    );
    const cards = wrapper.find("[data-testid='display-dock-cards']");
    expect(cards.text()).toContain("3");
    expect(cards.text()).toContain("Open");
    // The table cannot be read in one row — it is named instead.
    expect(cards.text()).toContain("w2 title");
    expect(wrapper.find("[data-testid='display-dock-mic']").text()).toBe("Listening");
    expect(overlay.layouts.at(-1)).toEqual({
      park: "bottom-right",
      width: 380,
      height: 150,
    });
    // A corner widget must never take the keyboard: it appears while the user
    // is typing in whatever it floats over.
    expect(overlay.reveal).toHaveBeenLastCalledWith({ focus: false });
  });

  // A failure keeps the row up to be read — and the pill that says "Resume"
  // has to resume, not mute what is already silent.
  it("stays up on a failure, and the mic pill restarts from there", async () => {
    const wrapper = await mountDock();
    daemon.wake();
    daemon.isAppDisplayActive.value = true;
    await flushPromises();
    daemon.isAppDisplayActive.value = false;
    await flushPromises();

    voice.failure.value = "The voice turn broke: no microphone";
    voice.end();
    voice.fireEnded();
    await flushPromises();

    expect(overlay.dismiss).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid='display-dock-mic']").text()).toBe("Resume");
    voice.start.mockClear();
    await wrapper.find("[data-testid='display-dock-mic']").trigger("click");
    expect(voice.start).toHaveBeenCalled();
  });

  it("puts the window away when the conversation settles", async () => {
    await mountDock();
    daemon.wake();
    await flushPromises();

    voice.end();
    voice.fireEnded();
    await flushPromises();

    expect(daemon.notifySessionEnd).toHaveBeenCalled();
    expect(overlay.dismiss).toHaveBeenCalledTimes(1);
  });

  // Today's rule, kept: muting ends the session on purpose and the window
  // stays, ready to resume.
  it("stays up while muted", async () => {
    const wrapper = await mountDock();
    daemon.wake();
    await flushPromises();

    wrapper.findComponent(VoiceStage).vm.$emit("toggleMute");
    voice.fireEnded();
    await flushPromises();

    expect(overlay.dismiss).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid='display-dock-stage']").exists()).toBe(true);
  });

  // The X on the corner row is the way out of a conversation this window owns.
  it("ends its own conversation from the mini row's X", async () => {
    const wrapper = await mountDock();
    daemon.wake();
    daemon.isAppDisplayActive.value = true;
    await flushPromises();
    daemon.isAppDisplayActive.value = false;
    await flushPromises();
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(true);

    await wrapper.find("[data-testid='display-dock-close']").trigger("click");
    await flushPromises();
    expect(voice.end).toHaveBeenCalled();
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(false);
    expect(overlay.dismiss).toHaveBeenCalledTimes(1);
  });
});

// Kafi's ask, the primary path: the conversation started in the ROOM. It never
// leaves that window — a Web Speech session cannot migrate — so the dock shows
// it in the corner and reports it without a microphone of its own.
describe("DisplayDockView — mirroring the app's session", () => {
  function roomIsTalking(
    overrides: Partial<AppDisplaySession> = {},
  ): AppDisplaySession {
    return { live: true, phase: "speaking", caption: "Two builds are green", ...overrides };
  }

  it("shows the room's conversation in the corner once the Display is left", async () => {
    const wrapper = await mountDock();
    // The user is IN the room: it draws its own orb, the dock stays away.
    daemon.isAppDisplayActive.value = true;
    daemon.appDisplaySession.value = roomIsTalking();
    await flushPromises();
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(false);

    // …and switches to a workspace mid-conversation.
    daemon.isAppDisplayActive.value = false;
    await flushPromises();
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='display-dock-caption']").text()).toBe(
      "Two builds are green",
    );
    expect(overlay.layouts.at(-1)).toEqual({
      park: "bottom-right",
      width: 380,
      height: 150,
    });
    // A corner widget never takes the keyboard, mirrored or not.
    expect(overlay.reveal).toHaveBeenLastCalledWith({ focus: false });
    // The mic lives in the app window: this pill reports, it does not switch.
    const mic = wrapper.find("[data-testid='display-dock-mic']");
    expect(mic.element.tagName).toBe("SPAN");
    expect(mic.text()).toBe("Listening");
    expect(voice.start).not.toHaveBeenCalled();
  });

  it("says Muted for a muted room, and never offers to Resume it", async () => {
    const wrapper = await mountDock();
    daemon.appDisplaySession.value = roomIsTalking({ phase: "muted", caption: "Muted" });
    await flushPromises();
    expect(wrapper.find("[data-testid='display-dock-mic']").text()).toBe("Muted");
  });

  // The room keeps talking — the X only puts the REPORT away.
  it("dismisses the mirror without touching the room, and takes it back on the next session", async () => {
    const wrapper = await mountDock();
    daemon.appDisplaySession.value = roomIsTalking();
    await flushPromises();
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(true);

    await wrapper.find("[data-testid='display-dock-close']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(false);
    expect(voice.end).not.toHaveBeenCalled();
    // Never closed: the window has to be there for the next glance away —
    // outside Tauri `dismiss()` closes it for good.
    expect(overlay.dismiss).not.toHaveBeenCalled();
    expect(overlay.hide).toHaveBeenCalled();

    // The room goes on saying things — still dismissed, this conversation.
    daemon.appDisplaySession.value = roomIsTalking({ caption: "One more thing" });
    await flushPromises();
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(false);

    // A NEW conversation starts: the row is back.
    daemon.appDisplaySession.value = { live: false, phase: "idle", caption: "" };
    await flushPromises();
    daemon.appDisplaySession.value = roomIsTalking({ caption: "Deploying now" });
    await flushPromises();
    const mini = wrapper.find("[data-testid='display-dock-mini']");
    expect(mini.exists()).toBe(true);
    expect(wrapper.find("[data-testid='display-dock-caption']").text()).toBe("Deploying now");
  });

  // The dock has a microphone in THIS window; a mirror is only a report.
  it("keeps its own conversation in front of a mirror", async () => {
    const wrapper = await mountDock();
    daemon.appDisplaySession.value = roomIsTalking();
    await flushPromises();
    daemon.wake();
    await flushPromises();

    expect(wrapper.find("[data-testid='display-dock-stage']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(false);
  });

  it("puts the window away once the room's conversation is over", async () => {
    const wrapper = await mountDock();
    daemon.appDisplaySession.value = roomIsTalking();
    await flushPromises();

    daemon.appDisplaySession.value = { live: false, phase: "idle", caption: "" };
    await flushPromises();
    expect(wrapper.find("[data-testid='display-dock-mini']").exists()).toBe(false);
    expect(overlay.dismiss).toHaveBeenCalledTimes(1);
  });
});
