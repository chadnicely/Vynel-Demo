// The shell's Display wiring, and nothing else: `displayVoice.ownsVoice` is the
// ONE reading of whether the Display feature holds this window's microphone —
// the room on screen, or a session still running behind another view — and
// while it does the voice overlay must be GONE, not hidden. The overlay creates
// its session and its wake link in setup, so a merely-invisible overlay would
// still answer a wake with a second orb and a second microphone.
//
// Shallow: every child is stubbed, so this pins the shell's own template and
// its command routing without booting the whole app.

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { ResizablePanel } from "@vynel/ui";
import type { VynelClient } from "@vynel/sdk";
import { createAppRouter } from "../../router.js";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { GLOBAL_TAB_ID, useUiStore } from "../../stores/ui-store.js";
import { useBrowserStore } from "../../stores/browser-store.js";
import { useDisplayVoice } from "../../composables/display/use-display-voice.js";
import AppShell from "./AppShell.vue";
import AppTitleBar from "./AppTitleBar.vue";
import VoiceOverlay from "../voice/VoiceOverlay.vue";

/** Every read the shell makes, answering empty. */
const quietClient = new Proxy(
  {},
  {
    get: () =>
      new Proxy(
        {},
        { get: () => async () => [] },
      ),
  },
) as unknown as VynelClient;

async function mountShell() {
  // No socket in this environment — the live channel goes "unavailable"
  // instead of dialing localhost and retrying for the whole run. The one POST
  // the window's voice makes on its own (the daemon's session hand-back) has
  // nothing to reach either.
  vi.stubGlobal("WebSocket", undefined);
  vi.stubGlobal("fetch", () => Promise.resolve({ ok: true } as Response));
  const router = createAppRouter();
  await router.push("/chat");
  await router.isReady();
  const wrapper = mount(AppShell, {
    shallow: true,
    global: {
      plugins: [
        router,
        createPinia(),
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
      provide: { [vynelClientKey as symbol]: quietClient },
    },
  });
  return { wrapper, ui: useUiStore(), router };
}

/** What the title-bar switch does when the user clicks it. */
function pressDisplaySwitch(wrapper: Awaited<ReturnType<typeof mountShell>>["wrapper"]) {
  wrapper.getComponent(AppTitleBar).vm.$emit("command", "toggle-display");
}

describe("AppShell — the Display", () => {
  it("the switch opens the room on the global tab and lights the title bar", async () => {
    const { wrapper, ui } = await mountShell();
    expect(wrapper.getComponent(AppTitleBar).props("displayOn")).toBe(false);

    pressDisplaySwitch(wrapper);
    await wrapper.vm.$nextTick();

    expect(ui.globalTab.shell.mainView).toBe("display");
    expect(ui.activeTabId).toBe(GLOBAL_TAB_ID);
    expect(wrapper.getComponent(AppTitleBar).props("displayOn")).toBe(true);
  });

  it("unmounts the voice overlay while the room holds the canvas", async () => {
    const { wrapper } = await mountShell();
    expect(wrapper.findComponent(VoiceOverlay).exists()).toBe(true);

    pressDisplaySwitch(wrapper);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(VoiceOverlay).exists()).toBe(false);

    pressDisplaySwitch(wrapper);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(VoiceOverlay).exists()).toBe(true);
  });

  // Leaving the room no longer hangs up: the conversation is the window's, so
  // the overlay stays out of the way and the switch stays lit. Only turning
  // the voice off gives the overlay its wake link back.
  it("keeps the overlay away while the conversation runs behind another view", async () => {
    const { wrapper, ui, router } = await mountShell();
    pressDisplaySwitch(wrapper);
    await wrapper.vm.$nextTick();

    await router.push("/home");
    await wrapper.vm.$nextTick();

    expect(ui.globalTab.shell.mainView).toBe("display");
    expect(wrapper.findComponent(VoiceOverlay).exists()).toBe(false);
    expect(wrapper.getComponent(AppTitleBar).props("displayOn")).toBe(true);

    pressDisplaySwitch(wrapper);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(VoiceOverlay).exists()).toBe(true);
    expect(wrapper.getComponent(AppTitleBar).props("displayOn")).toBe(false);
  });

  // With the voice off, the room is still the thing on screen — it needs the
  // window's daemon link, so the overlay stays away for that reason alone.
  it("keeps the overlay away for a room with the voice switched off", async () => {
    const { wrapper, ui } = await mountShell();
    ui.globalTab.shell.mainView = "display";
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(VoiceOverlay).exists()).toBe(false);
    expect(wrapper.getComponent(AppTitleBar).props("displayOn")).toBe(true);
  });

  // `ui.isVoiceOverlayOpen` is the OVERLAY's switch — the Display owns the
  // window's voice, so opening the room must never raise the overlay too.
  it("never opens the overlay's own session", async () => {
    const { wrapper, ui } = await mountShell();
    pressDisplaySwitch(wrapper);
    await wrapper.vm.$nextTick();
    expect(ui.isVoiceOverlayOpen).toBe(false);
  });

  // The overlay's switch must not outlive the overlay: left ON behind the room
  // it would dim the page below for a dialog that is no longer mounted, with
  // nothing left to observe the flag and turn it off.
  it("clears the overlay's switch when the Display takes the window's voice", async () => {
    const { wrapper, ui } = await mountShell();
    const browser = useBrowserStore();
    ui.isVoiceOverlayOpen = true;
    await wrapper.vm.$nextTick();
    expect(browser.isObscured).toBe(true);

    // Not the switch — a menu row taking the canvas, with the voice still off.
    ui.globalTab.shell.mainView = "display";
    await wrapper.vm.$nextTick();

    expect(ui.isVoiceOverlayOpen).toBe(false);
    expect(browser.isObscured).toBe(false);
  });

  // "Start voice" (the palette entry, the menu row) belongs to whoever owns
  // the microphone. Once the Display has it, raising the overlay would start a
  // second session with no orb to show it, and dim the page for an overlay
  // that isn't mounted.
  it("routes 'Start voice' to the window's voice once the Display owns it", async () => {
    const { wrapper, ui } = await mountShell();
    const displayVoice = useDisplayVoice();
    const startVoice = () =>
      wrapper.getComponent(AppTitleBar).vm.$emit("command", "start-voice");

    startVoice();
    expect(ui.isVoiceOverlayOpen).toBe(true);
    ui.isVoiceOverlayOpen = false;

    // The room on screen with the voice off is already the Display's to answer.
    ui.globalTab.shell.mainView = "display";
    await wrapper.vm.$nextTick();

    startVoice();
    expect(ui.isVoiceOverlayOpen).toBe(false);
    expect(displayVoice.isLive).toBe(true);
  });
});

// The view switch (Kafi, 2026-08-22): Nodes | Display | Normal in the title
// bar, and full view — the chrome stepping out from under the Nodes screen or
// the Display. Derived, not stored: the switch reads the route + the Display
// toggle back; only the full-view flag is the store's, and it is sticky.
describe("AppShell — the view switch", () => {
  function press(wrapper: Awaited<ReturnType<typeof mountShell>>["wrapper"], id: string) {
    wrapper.getComponent(AppTitleBar).vm.$emit("command", id);
  }
  const titleBar = (wrapper: Awaited<ReturnType<typeof mountShell>>["wrapper"]) =>
    wrapper.getComponent(AppTitleBar).props();

  it("Nodes goes to the Nodes screen and reads back; Normal returns to the chat", async () => {
    const { wrapper, router } = await mountShell();
    expect(titleBar(wrapper).viewMode).toBe("normal");

    press(wrapper, "open-nodes");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("nodes"));
    await wrapper.vm.$nextTick();
    expect(titleBar(wrapper).viewMode).toBe("nodes");

    press(wrapper, "view-normal");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("chat"));
    await wrapper.vm.$nextTick();
    expect(titleBar(wrapper).viewMode).toBe("normal");
  });

  // Nodes opens FULL by itself (Kafi, 2026-08-22): sidebar gone, the bar its
  // corner cluster; Normal brings the chrome back — exactly as it was.
  it("Nodes opens full — sidebar gone, bar collapsed; Normal brings the chrome back", async () => {
    const { wrapper, router } = await mountShell();
    expect(wrapper.findAllComponents(ResizablePanel)).toHaveLength(1);
    expect(titleBar(wrapper).fullView).toBe(false);

    press(wrapper, "open-nodes");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("nodes"));
    await wrapper.vm.$nextTick();
    expect(titleBar(wrapper).fullView).toBe(true);
    expect(wrapper.findAllComponents(ResizablePanel)).toHaveLength(0);
    expect(wrapper.get(".app-shell").classes()).toContain("full-view");

    press(wrapper, "view-normal");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("chat"));
    await wrapper.vm.$nextTick();
    expect(titleBar(wrapper).fullView).toBe(false);
    expect(wrapper.findAllComponents(ResizablePanel)).toHaveLength(1);
  });

  // The tasks rail is the chat's: the title bar offers its glyph only there,
  // and the palette's toggle cannot flip the preference invisibly elsewhere.
  it("offers and honours the tasks toggle on the chat only", async () => {
    const { wrapper, ui } = await mountShell();
    expect(titleBar(wrapper).showsTasksToggle).toBe(true);
    expect(ui.isTasksPanelOpen).toBe(true);

    ui.globalTab.shell.mainView = "application";
    await wrapper.vm.$nextTick();
    expect(titleBar(wrapper).showsTasksToggle).toBe(false);
    press(wrapper, "toggle-tasks");
    expect(ui.isTasksPanelOpen).toBe(true);

    ui.globalTab.shell.mainView = "chat";
    await wrapper.vm.$nextTick();
    press(wrapper, "toggle-tasks");
    expect(ui.isTasksPanelOpen).toBe(false);
  });

  it("the Display opens full too, and leaving it restores the chrome", async () => {
    const { wrapper } = await mountShell();
    press(wrapper, "view-display");
    await wrapper.vm.$nextTick();
    expect(titleBar(wrapper).fullView).toBe(true);
    expect(wrapper.findAllComponents(ResizablePanel)).toHaveLength(0);

    press(wrapper, "view-normal");
    await flushPromises();
    expect(titleBar(wrapper).fullView).toBe(false);
    expect(wrapper.findAllComponents(ResizablePanel)).toHaveLength(1);
  });

  it("Display opens the room and takes the voice; again closes it", async () => {
    const { wrapper, ui } = await mountShell();
    const displayVoice = useDisplayVoice();

    press(wrapper, "view-display");
    await wrapper.vm.$nextTick();
    expect(ui.globalTab.shell.mainView).toBe("display");
    expect(titleBar(wrapper).viewMode).toBe("display");
    expect(displayVoice.isLive).toBe(true);

    press(wrapper, "view-display");
    await wrapper.vm.$nextTick();
    expect(ui.globalTab.shell.mainView).toBe("chat");
    expect(titleBar(wrapper).viewMode).toBe("normal");
    expect(displayVoice.isLive).toBe(false);
  });

  it("Normal leaves the room with the conversation still running, lit on the bar", async () => {
    const { wrapper, ui } = await mountShell();
    const displayVoice = useDisplayVoice();
    press(wrapper, "view-display");
    await wrapper.vm.$nextTick();

    press(wrapper, "view-normal");
    await flushPromises();

    expect(ui.globalTab.shell.mainView).toBe("chat");
    expect(titleBar(wrapper).viewMode).toBe("normal");
    expect(displayVoice.isLive).toBe(true);
    expect(titleBar(wrapper).displayOn).toBe(true);
  });

  // Display → Nodes leaves the room parked on the global tab (the Nodes screen
  // is a route, not a canvas view). Normal from there must land on the chat —
  // a raw route push would have brought the parked room straight back with
  // the Display segment pressed (review, 2026-08-22).
  it("Normal from Nodes lands on the chat even with a room parked behind it", async () => {
    const { wrapper, ui, router } = await mountShell();
    press(wrapper, "view-display");
    await wrapper.vm.$nextTick();
    press(wrapper, "open-nodes");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("nodes"));
    expect(ui.globalTab.shell.mainView).toBe("display");

    press(wrapper, "view-normal");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("chat"));
    await wrapper.vm.$nextTick();

    expect(ui.globalTab.shell.mainView).toBe("chat");
    expect(titleBar(wrapper).viewMode).toBe("normal");
  });

});
