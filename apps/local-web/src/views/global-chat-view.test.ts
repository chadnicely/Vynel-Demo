// The global canvas's Display branch, and nothing else: the room renders where
// the tab points at it, and the tasks rail steps aside while it does — the
// Display paints its own dark ground whatever the app theme is, and a lit rail
// glued to its edge reads as breakage.
//
// Shallow: every child is stubbed, so this pins the canvas's own template
// without booting the chat, its streams, or the orb.

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { createAppRouter } from "../router.js";
import { vynelClientKey } from "../plugins/vynel-client.js";
import { useUiStore } from "../stores/ui-store.js";
import type { ChatMainView } from "../stores/ui-store.js";
import GlobalChatView from "./GlobalChatView.vue";
import DisplayView from "./display/DisplayView.vue";
import TasksPanel from "../components/tasks/TasksPanel.vue";

/** Every read the canvas makes, answering empty. */
const quietClient = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => [] }) },
) as unknown as VynelClient;

async function mountCanvas(mainView: ChatMainView) {
  vi.stubGlobal("WebSocket", undefined);
  const router = createAppRouter();
  await router.push("/chat");
  await router.isReady();
  const pinia = createPinia();
  const wrapper = mount(GlobalChatView, {
    shallow: true,
    global: {
      plugins: [
        router,
        pinia,
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
      provide: { [vynelClientKey as symbol]: quietClient },
    },
  });
  const ui = useUiStore();
  ui.globalTab.shell.mainView = mainView;
  await wrapper.vm.$nextTick();
  return { wrapper, ui };
}

describe("GlobalChatView — the Display branch", () => {
  it("renders the room when the tab points at it", async () => {
    const { wrapper } = await mountCanvas("display");
    expect(wrapper.findComponent(DisplayView).exists()).toBe(true);
  });

  // The tasks rail is the CHAT's (Kafi, 2026-08-22): open there by default,
  // off the room and off every section.
  it("keeps the tasks rail beside the chat only — not the room, not a section", async () => {
    const { wrapper, ui } = await mountCanvas("display");
    expect(ui.isTasksPanelOpen).toBe(true); // the rail opens by default
    expect(wrapper.findComponent(TasksPanel).exists()).toBe(false);

    ui.globalTab.shell.mainView = "chat";
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(DisplayView).exists()).toBe(false);
    expect(wrapper.findComponent(TasksPanel).exists()).toBe(true);

    ui.globalTab.shell.mainView = "tasks";
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(TasksPanel).exists()).toBe(false);
    // The preference survives the detour: back on the chat, the rail is back.
    ui.globalTab.shell.mainView = "chat";
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(TasksPanel).exists()).toBe(true);
  });
});
