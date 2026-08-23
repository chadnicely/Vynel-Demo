// The title-bar switch: which room it opens, what it restores, what it tells
// the display dock — and, since 2026-08-21, the window's voice itself. On
// starts the conversation and shows the room; off ends it from wherever the
// user happens to be. The voice session is stubbed (happy-dom has no Web
// Speech and no microphone); everything else runs for real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, type Ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import type { VynelClient } from "@vynel/sdk";
import { createAppRouter } from "../../router.js";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { GLOBAL_TAB_ID, useUiStore } from "../../stores/ui-store.js";
import { useLiveChannelStore } from "../../stores/live-channel-store.js";
import type { VoiceCommandSessionView } from "../voice/voice-command-session-types.js";
import { useDisplayVoice } from "./use-display-voice.js";
import { useDisplayToggle, type DisplayToggle } from "./use-display-toggle.js";

interface VoiceStub {
  view: Ref<VoiceCommandSessionView>;
  failure: Ref<string | null>;
  isActive: Ref<boolean>;
  start: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  currentSessionId: ReturnType<typeof vi.fn>;
  speakExternal: ReturnType<typeof vi.fn>;
}

const voice = vi.hoisted(() => ({}) as VoiceStub);

vi.mock("../voice/use-voice-session.js", async () => {
  const { computed, ref } = await import("vue");
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
  voice.currentSessionId = vi.fn(() => null);
  voice.speakExternal = vi.fn(() => true);
  return { useVoiceSession: () => voice };
});

/** Every `setDisplayActive` the toggle announced, in order — what the display
 *  dock hears (it hides while the room is on screen). */
let displayActiveCalls: boolean[];

function announcingClient(): VynelClient {
  return {
    voice: {
      setDisplayActive: async ({ active }: { active: boolean }) => {
        displayActiveCalls.push(active);
        return {};
      },
      setDisplaySession: async () => ({ published: false }),
    },
  } as unknown as VynelClient;
}

async function mountToggle(startPath = "/chat") {
  const pinia = createPinia();
  const router = createAppRouter();
  await router.push(startPath);
  await router.isReady();
  let toggle!: DisplayToggle;
  const wrapper = mount(
    defineComponent({
      setup() {
        toggle = useDisplayToggle();
        return () => h("div");
      },
    }),
    {
      global: {
        plugins: [router, pinia],
        provide: { [vynelClientKey as symbol]: announcingClient() },
      },
    },
  );
  return {
    wrapper,
    router,
    toggle: () => toggle,
    ui: useUiStore(),
    live: useLiveChannelStore(),
    voiceStore: useDisplayVoice(),
  };
}

// The tab strip persists itself, active tab included — so a case that opens a
// workspace tab would hand the NEXT case a workspace tab already in front.
beforeEach(() => {
  localStorage.clear();
  displayActiveCalls = [];
  voice.view.value = { state: "ended", transcript: "", spokenText: "", notice: "" };
  voice.start.mockClear();
  voice.end.mockClear();
  // No socket in this environment, and nothing here should reach the network.
  vi.stubGlobal("WebSocket", undefined);
  vi.stubGlobal("fetch", () => Promise.resolve({ ok: true } as Response));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The first case boots a REAL router (the toggle's one reading of "room on
// screen" is the route), which takes ~6 s alone and crosses vitest's 20 s
// default under full-suite contention — a later case then inherits a half-
// navigated router and fails on its own. Not a logic timeout: the budget is
// for the boot, the cases themselves assert in milliseconds.
vi.setConfig({ testTimeout: 60_000 });

describe("useDisplayToggle", () => {
  it("opens the room on the global tab and restores the view it took", async () => {
    const { toggle, ui } = await mountToggle();
    ui.globalTab.shell.mainView = "account";

    toggle().toggleDisplay();
    expect(ui.globalTab.shell.mainView).toBe("display");
    expect(ui.activeTabId).toBe(GLOBAL_TAB_ID);
    expect(toggle().isDisplayActive.value).toBe(true);

    toggle().toggleDisplay();
    expect(ui.globalTab.shell.mainView).toBe("account");
    expect(toggle().isDisplayActive.value).toBe(false);
  });

  it("with nothing remembered it hands the canvas back to the chat", async () => {
    const { toggle, ui } = await mountToggle();
    toggle().toggleDisplay();
    toggle().toggleDisplay();
    expect(ui.globalTab.shell.mainView).toBe("chat");
  });

  // A tab parked on the Display while the canvas is elsewhere (a menu row
  // took over, the switch was never flipped off) must not restore INTO the
  // Display — that is a switch that does nothing.
  it("never restores into the Display itself", async () => {
    const { toggle, ui } = await mountToggle("/nodes");
    ui.globalTab.shell.mainView = "display";

    toggle().toggleDisplay(); // off screen, so this OPENS the room
    await flushPromises(); // the room lands with the chat route, not before
    expect(ui.globalTab.shell.mainView).toBe("display");
    toggle().toggleDisplay();
    expect(ui.globalTab.shell.mainView).toBe("chat");
  });

  it("comes back to the chat route from anywhere else", async () => {
    const { toggle, ui, router } = await mountToggle("/nodes");
    expect(toggle().isDisplayActive.value).toBe(false);

    toggle().toggleDisplay();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("chat");
    expect(ui.globalTab.shell.mainView).toBe("display");
    expect(toggle().isDisplayActive.value).toBe(true);
  });

  // The one that keeps the wake word alive: the room is only ON SCREEN where
  // GlobalChatView renders it. Reading the tab's view alone would call it
  // active from Home — mic dead, overlay still suppressed behind it.
  it("goes quiet when the canvas leaves, without touching the tab's view", async () => {
    const { toggle, ui, router } = await mountToggle();
    toggle().toggleDisplay();
    expect(toggle().isDisplayActive.value).toBe(true);

    await router.push("/home");
    await flushPromises();
    expect(toggle().isDisplayActive.value).toBe(false);
    expect(ui.globalTab.shell.mainView).toBe("display");
  });

  // The global tab's room is not the workspace tab's room: switching to a
  // workspace leaves the global board behind (its own canvas is elsewhere).
  it("is not active while a workspace tab holds the canvas", async () => {
    const { toggle, ui } = await mountToggle();
    toggle().toggleDisplay();
    ui.addWorkspaceTab("ws-1");
    expect(toggle().isDisplayActive.value).toBe(false);
  });

  // The surface decides the scope: on a workspace tab the switch opens THAT
  // room's board, on its own route, without yanking you to the global tab.
  it("opens the workspace tab's own room, and leaves the global tab alone", async () => {
    const { toggle, ui, router } = await mountToggle();
    const workspaceTab = ui.addWorkspaceTab("ws-1");

    toggle().toggleDisplay();
    // The canvas routes are lazily imported, so the navigation settles a tick
    // or two after the switch — wait for it rather than for one flush. A
    // generous budget: under a loaded machine (the full suite alongside dev
    // servers) the lazy import alone has blown waitFor's 1s default — the
    // only flake this file ever showed (2026-08-24).
    await vi.waitFor(
      () => expect(router.currentRoute.value.name).toBe("workspace"),
      { timeout: 10_000 },
    );

    expect(workspaceTab.shell.mainView).toBe("display");
    expect(ui.activeTabId).toBe(workspaceTab.id);
    expect(ui.globalTab.shell.mainView).toBe("chat");
    expect(toggle().isDisplayActive.value).toBe(true);

    toggle().toggleDisplay();
    expect(workspaceTab.shell.mainView).toBe("chat");
  });

  // The display dock is the same Display in another window: it hides while
  // this one has the room, and it only knows because the toggle says so.
  it("tells the dock when the room comes and goes", async () => {
    const { toggle } = await mountToggle();
    // A window that boots outside the room still has to say so — the dock
    // would otherwise sit hidden waiting for a change that never comes.
    expect(displayActiveCalls).toEqual([false]);

    toggle().toggleDisplay();
    await flushPromises();
    expect(displayActiveCalls).toEqual([false, true]);

    toggle().toggleDisplay();
    await flushPromises();
    expect(displayActiveCalls).toEqual([false, true, false]);
  });

  // An engine restart empties the hub's memo of the room's state, and nothing
  // about the room changes to announce it again — so the socket coming back
  // says it over, or the dock spends the rest of the session in the wrong shape.
  it("says it again when the socket comes back", async () => {
    const { toggle, live } = await mountToggle();
    toggle().toggleDisplay();
    await flushPromises();
    expect(displayActiveCalls).toEqual([false, true]);

    live.status = "reconnecting";
    await flushPromises();
    expect(displayActiveCalls).toEqual([false, true]);

    live.status = "open";
    await flushPromises();
    expect(displayActiveCalls).toEqual([false, true, true]);
  });

  it("says the room is gone however it was left", async () => {
    const { toggle, router, wrapper } = await mountToggle();
    toggle().toggleDisplay();
    await flushPromises();
    expect(displayActiveCalls.at(-1)).toBe(true);

    // Not the switch — a menu row, taking the canvas somewhere else.
    await router.push("/home");
    await flushPromises();
    expect(displayActiveCalls.at(-1)).toBe(false);

    // And the window itself going away.
    await router.push("/chat");
    await flushPromises();
    expect(displayActiveCalls.at(-1)).toBe(true);
    wrapper.unmount();
    await flushPromises();
    expect(displayActiveCalls.at(-1)).toBe(false);
  });

  it("remembers where each tab was, not where the last one was", async () => {
    const { toggle, ui, router } = await mountToggle();
    ui.globalTab.shell.mainView = "account";
    toggle().toggleDisplay();
    toggle().toggleDisplay();
    expect(ui.globalTab.shell.mainView).toBe("account");

    const workspaceTab = ui.addWorkspaceTab("ws-1");
    ui.activeTab.shell.mainView = "knowledge";
    toggle().toggleDisplay();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("workspace"));
    toggle().toggleDisplay();
    expect(workspaceTab.shell.mainView).toBe("knowledge");

    // The global tab's own memory survived the detour through the workspace.
    expect(ui.globalTab.shell.mainView).toBe("account");
  });
});

// The switch is the real voice on/off (Kafi, 2026-08-21). It used to open a
// screen and let the room start its own session, which made walking away from
// the Display hang up the call — and put the dock's mirror, the corner form of
// that very room, permanently out of reach.
describe("useDisplayToggle — the switch is the voice", () => {
  it("on starts the window's voice and shows the room", async () => {
    const { toggle, ui, voiceStore } = await mountToggle();
    expect(voiceStore.isLive).toBe(false);

    toggle().toggleDisplay();

    expect(voiceStore.isLive).toBe(true);
    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(ui.globalTab.shell.mainView).toBe("display");
  });

  it("off ends the conversation and hands the canvas back", async () => {
    const { toggle, ui, voiceStore } = await mountToggle();
    ui.globalTab.shell.mainView = "account";
    toggle().toggleDisplay();

    toggle().toggleDisplay();

    expect(voiceStore.isLive).toBe(false);
    expect(voice.end).toHaveBeenCalledTimes(1);
    expect(ui.globalTab.shell.mainView).toBe("account");
  });

  // The switch reads ON wherever the user is, because the conversation is
  // still theirs — so pressing it hangs up, rather than dragging them back to
  // the room to do it.
  it("off from another view ends the conversation without going there", async () => {
    const { toggle, ui, router, voiceStore } = await mountToggle();
    toggle().toggleDisplay();
    await router.push("/home");
    await flushPromises();
    expect(toggle().isDisplayActive.value).toBe(false);
    expect(voiceStore.ownsVoice).toBe(true);

    toggle().toggleDisplay();

    expect(voiceStore.isLive).toBe(false);
    expect(router.currentRoute.value.name).toBe("home");
    // Nothing to restore: the room was not the thing on screen.
    expect(ui.globalTab.shell.mainView).toBe("display");
  });

  // The room needs the window's daemon link even with voice off, or a wake
  // would land nowhere while the user sits looking at the orb.
  it("tells the window's voice whether the room is on screen", async () => {
    const { toggle, router, voiceStore } = await mountToggle("/home");
    expect(voiceStore.ownsVoice).toBe(false);

    toggle().showDisplay();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("chat");
    expect(voiceStore.ownsVoice).toBe(true);
    // A screen, not a conversation: `showDisplay` starts nothing.
    expect(voiceStore.isLive).toBe(false);
    expect(voice.start).not.toHaveBeenCalled();
  });

  // A wake landed in the dock and the daemon asked the app to come forward.
  // Answering it with the SWITCH would turn off the very conversation the wake
  // just announced.
  it("opens the room when the window's voice rings for it", async () => {
    const { toggle, ui, voiceStore } = await mountToggle();
    voiceStore.start();
    voice.start.mockClear();

    voiceStore.showDisplayRequestCount += 1;
    await flushPromises();

    expect(ui.globalTab.shell.mainView).toBe("display");
    expect(toggle().isDisplayActive.value).toBe(true);
    expect(voiceStore.isLive).toBe(true);
    expect(voice.end).not.toHaveBeenCalled();
  });
});

// The view switch's verbs (Kafi, 2026-08-22). Picking Display is a place to
// go, not a hang-up: it joins a conversation already running, starts one when
// nobody has the microphone, and only closes the room when the room is what
// is on screen. Leaving for the normal view never touches the voice.
describe("useDisplayToggle — the view switch", () => {
  it("pick from nothing shows the room and starts the voice", async () => {
    const { toggle, ui, voiceStore } = await mountToggle();
    ui.globalTab.shell.mainView = "account";

    toggle().pickDisplay();

    expect(ui.globalTab.shell.mainView).toBe("display");
    expect(voiceStore.isLive).toBe(true);
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  it("pick in the room is the switch's off — the voice ends, the canvas comes back", async () => {
    const { toggle, ui, voiceStore } = await mountToggle();
    ui.globalTab.shell.mainView = "account";
    toggle().pickDisplay();

    toggle().pickDisplay();

    expect(ui.globalTab.shell.mainView).toBe("account");
    expect(voiceStore.isLive).toBe(false);
    expect(voice.end).toHaveBeenCalledTimes(1);
  });

  it("pick from another view joins the running conversation instead of restarting it", async () => {
    const { toggle, ui, router, voiceStore } = await mountToggle();
    toggle().pickDisplay();
    await router.push("/home");
    await flushPromises();
    expect(toggle().isDisplayActive.value).toBe(false);

    toggle().pickDisplay();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("chat");
    expect(ui.globalTab.shell.mainView).toBe("display");
    expect(voiceStore.isLive).toBe(true);
    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(voice.end).not.toHaveBeenCalled();
  });

  it("leave hands the canvas back and keeps the conversation running", async () => {
    const { toggle, ui, voiceStore } = await mountToggle();
    ui.globalTab.shell.mainView = "account";
    toggle().pickDisplay();

    toggle().leaveDisplay();

    expect(ui.globalTab.shell.mainView).toBe("account");
    expect(toggle().isDisplayActive.value).toBe(false);
    expect(voiceStore.isLive).toBe(true);
    expect(voice.end).not.toHaveBeenCalled();
  });

  it("leave is a no-op when the room is not on screen", async () => {
    const { toggle, ui } = await mountToggle("/home");
    ui.globalTab.shell.mainView = "account";
    toggle().leaveDisplay();
    expect(ui.globalTab.shell.mainView).toBe("account");
  });
});
