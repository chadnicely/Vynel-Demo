// The shell's Display wiring, and nothing else: the room's switch is the ONE
// reading of whether the Display holds the canvas, and while it does the voice
// overlay must be GONE — not hidden. The overlay creates its session and its
// wake link in setup, so a merely-invisible overlay would still answer a wake
// with a second orb and a second microphone behind the room.
//
// Shallow: every child is stubbed, so this pins the shell's own template and
// its command routing without booting the whole app.

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { createAppRouter } from "../../router.js";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { GLOBAL_TAB_ID, useUiStore } from "../../stores/ui-store.js";
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
  // instead of dialing localhost and retrying for the whole run.
  vi.stubGlobal("WebSocket", undefined);
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

  // The room is only on screen where the global chat canvas renders it —
  // leaving for another surface gives the wake word its overlay back, even
  // though the tab is still pointed at the Display.
  it("gives the overlay back the moment the canvas goes elsewhere", async () => {
    const { wrapper, ui, router } = await mountShell();
    pressDisplaySwitch(wrapper);
    await wrapper.vm.$nextTick();

    await router.push("/home");
    await wrapper.vm.$nextTick();

    expect(ui.globalTab.shell.mainView).toBe("display");
    expect(wrapper.findComponent(VoiceOverlay).exists()).toBe(true);
    expect(wrapper.getComponent(AppTitleBar).props("displayOn")).toBe(false);
  });

  // `ui.isVoiceOverlayOpen` is the OVERLAY's switch — the Display owns its own
  // session, so opening the room must never raise the overlay too.
  it("never opens the overlay's own session", async () => {
    const { wrapper, ui } = await mountShell();
    pressDisplaySwitch(wrapper);
    await wrapper.vm.$nextTick();
    expect(ui.isVoiceOverlayOpen).toBe(false);
  });

  // "Start voice" (the palette entry, the menu row) belongs to whoever owns
  // the microphone. With the room up that is the room — raising the overlay
  // behind it would start a second session with no orb to show it, and dim
  // the page for an overlay that isn't mounted.
  it("routes 'Start voice' to the room's own microphone while it holds the canvas", async () => {
    const { wrapper, ui } = await mountShell();
    const startVoice = () =>
      wrapper.getComponent(AppTitleBar).vm.$emit("command", "start-voice");

    startVoice();
    expect(ui.isVoiceOverlayOpen).toBe(true);
    ui.isVoiceOverlayOpen = false;

    pressDisplaySwitch(wrapper);
    await wrapper.vm.$nextTick();

    startVoice();
    expect(ui.isVoiceOverlayOpen).toBe(false);
    expect(ui.displayVoiceRequestCount).toBe(1);
  });
});
