// The workspace canvas's Display branch: a workspace room has its OWN board
// (the same scope its `display_*` tools write to), and the side panels step
// aside while it holds the canvas — the Display paints its own dark ground
// whatever the app theme is, and a lit rail glued to its edge reads as
// breakage.
//
// Shallow: every child is stubbed, so this pins the canvas's own template
// without booting the chat, its streams, or the orb.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { createAppRouter } from "../router.js";
import { vynelClientKey } from "../plugins/vynel-client.js";
import { useUiStore } from "../stores/ui-store.js";
import type { ChatMainView } from "../stores/ui-store.js";
import WorkspaceView from "./WorkspaceView.vue";
import DisplayView from "./display/DisplayView.vue";
import TasksPanel from "../components/tasks/TasksPanel.vue";
import FilesPanel from "../components/workspace/FilesPanel.vue";

/** Every read the canvas makes, answering empty. */
const quietClient = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => [] }) },
) as unknown as VynelClient;

// The tab strip persists itself, active tab included — start every case on a
// clean strip so one case's workspace tab never fronts the next.
beforeEach(() => {
  localStorage.clear();
});

async function mountCanvas(mainView: ChatMainView) {
  vi.stubGlobal("WebSocket", undefined);
  const router = createAppRouter();
  await router.push("/workspace");
  await router.isReady();
  const pinia = createPinia();
  const ui = useUiStore(pinia);
  ui.addWorkspaceTab("ws-7");
  // Through the store, always: the object addWorkspaceTab hands back is the
  // raw row, and writing to it moves the value without waking the view.
  const setView = (view: ChatMainView) => {
    ui.activeTab.shell.mainView = view;
  };
  setView(mainView);

  const wrapper = mount(WorkspaceView, {
    shallow: true,
    global: {
      // The pane tools stay real: the files panel's switch is local state, so
      // the only honest way to open it is to click it.
      stubs: { IconButton: false },
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
  await wrapper.vm.$nextTick();
  return { wrapper, ui, setView };
}

describe("WorkspaceView — the Display branch", () => {
  it("renders the room on THIS workspace's board", async () => {
    const { wrapper } = await mountCanvas("display");
    const room = wrapper.findComponent(DisplayView);
    expect(room.exists()).toBe(true);
    expect(room.props("scope")).toEqual({ kind: "workspace", workspaceId: "ws-7" });
  });

  it("keeps the tasks rail off the room, and beside every other canvas", async () => {
    const { wrapper, ui, setView } = await mountCanvas("display");
    expect(ui.isTasksPanelOpen).toBe(true); // the rail opens by default
    expect(wrapper.findComponent(TasksPanel).exists()).toBe(false);

    setView("chat");
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(DisplayView).exists()).toBe(false);
    expect(wrapper.findComponent(TasksPanel).exists()).toBe(true);
  });

  it("keeps the files panel off it too, without forgetting it was open", async () => {
    const { wrapper, setView } = await mountCanvas("chat");
    await wrapper.get('[aria-label="Toggle files"]').trigger("click");
    expect(wrapper.findComponent(FilesPanel).exists()).toBe(true);

    setView("display");
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(FilesPanel).exists()).toBe(false);

    setView("chat");
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(FilesPanel).exists()).toBe(true);
  });
});
