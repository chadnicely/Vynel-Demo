import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createAppRouter } from "../../router.js";
import { GLOBAL_TAB_ID, useUiStore } from "../../stores/ui-store.js";
import { useDisplayToggle, type DisplayToggle } from "./use-display-toggle.js";

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
    { global: { plugins: [router, pinia] } },
  );
  return { wrapper, router, toggle: () => toggle, ui: useUiStore() };
}

// The tab strip persists itself, active tab included — so a case that opens a
// workspace tab would hand the NEXT case a workspace tab already in front.
beforeEach(() => {
  localStorage.clear();
});

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
    // or two after the switch — wait for it rather than for one flush.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("workspace"));

    expect(workspaceTab.shell.mainView).toBe("display");
    expect(ui.activeTabId).toBe(workspaceTab.id);
    expect(ui.globalTab.shell.mainView).toBe("chat");
    expect(toggle().isDisplayActive.value).toBe(true);

    toggle().toggleDisplay();
    expect(workspaceTab.shell.mainView).toBe("chat");
  });

  it("remembers where each tab was, not where the last one was", async () => {
    const { toggle, ui, router } = await mountToggle();
    ui.globalTab.shell.mainView = "account";
    toggle().toggleDisplay();

    const workspaceTab = ui.addWorkspaceTab("ws-1");
    ui.activeTab.shell.mainView = "knowledge";
    toggle().toggleDisplay();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("workspace"));
    toggle().toggleDisplay();
    expect(workspaceTab.shell.mainView).toBe("knowledge");

    // The global tab's own memory survived the detour through the workspace.
    ui.activateTab(GLOBAL_TAB_ID);
    await router.push("/chat");
    await flushPromises();
    expect(toggle().isDisplayActive.value).toBe(true);
    toggle().toggleDisplay();
    expect(ui.globalTab.shell.mainView).toBe("account");
  });
});
