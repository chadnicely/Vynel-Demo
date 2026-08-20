import { describe, expect, it } from "vitest";
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

  it("is not active while a workspace tab holds the canvas", async () => {
    const { toggle, ui } = await mountToggle();
    toggle().toggleDisplay();
    ui.addWorkspaceTab("ws-1");
    expect(toggle().isDisplayActive.value).toBe(false);
  });
});
