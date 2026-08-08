import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { useConversationSidebarStore } from "../../stores/conversation-sidebar-store.js";
import ConversationSidebar from "./ConversationSidebar.vue";

// The panel resize (Chad, 2026-08-09): drag the left edge, width persists,
// out-of-range stored values fall back — the thread inside reflows (the
// no-side-scroll rule lives in ThreadStream's CSS).

function mountSidebar() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const sidebar = useConversationSidebarStore();
  sidebar.openSession({ sessionId: "s1", title: "James · Claw Launcher" });
  const wrapper = mount(ConversationSidebar, {
    global: {
      plugins: [pinia, [VueQueryPlugin, { queryClient: new QueryClient() }]],
      provide: {
        [vynelClientKey as symbol]: {
          workspaces: { list: async () => [] },
        },
      },
      // The hosted panes fetch their threads — out of scope here.
      stubs: { LiveSessionPane: true, WorkspaceSidebarThread: true },
    },
  });
  return wrapper;
}

afterEach(() => {
  localStorage.clear();
  document.body.style.userSelect = "";
});

describe("ConversationSidebar resize", () => {
  // test: correct expectation — out-of-range stored widths CLAMP (was:
  // fall back to the default). One home now: `usePanelResize` carries
  // ResizablePanel's pinned semantics — an old stored layout degrades to
  // the nearest legal width instead of resetting.
  it("opens at the stored width; an out-of-range value clamps", () => {
    localStorage.setItem("vynel.sidebar-width", "700");
    const stored = mountSidebar();
    expect(
      stored.get("[data-testid=conversation-sidebar]").attributes("style"),
    ).toContain("width: 700px");

    localStorage.setItem("vynel.sidebar-width", "9999");
    const clamped = mountSidebar();
    expect(
      clamped.get("[data-testid=conversation-sidebar]").attributes("style"),
    ).toContain("width: 920px");
  });

  it("dragging the handle resizes within the clamp and persists on release", async () => {
    const wrapper = mountSidebar();
    const handle = wrapper.get(".resize-handle");

    await handle.trigger("pointerdown", { pointerId: 1, clientX: 1160 });
    handle.element.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: 1000 }),
    );
    await wrapper.vm.$nextTick();
    expect(
      wrapper.get("[data-testid=conversation-sidebar]").attributes("style"),
    ).toContain("width: 600px");

    // Past the minimum: the width clamps.
    handle.element.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: 1590 }),
    );
    await wrapper.vm.$nextTick();
    expect(
      wrapper.get("[data-testid=conversation-sidebar]").attributes("style"),
    ).toContain("width: 320px");

    handle.element.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1 }),
    );
    expect(localStorage.getItem("vynel.sidebar-width")).toBe("320");
  });

  it("arrow keys resize the panel from the keyboard (right panel: ArrowLeft grows)", async () => {
    const wrapper = mountSidebar();
    const handle = wrapper.get(".resize-handle");
    await handle.trigger("keydown", { key: "ArrowLeft" });
    expect(
      wrapper.get("[data-testid=conversation-sidebar]").attributes("style"),
    ).toContain("width: 448px");
    expect(localStorage.getItem("vynel.sidebar-width")).toBe("448");
  });

  it("suspends text selection during the drag and restores it even on unmount mid-drag", async () => {
    const wrapper = mountSidebar();
    const handle = wrapper.get(".resize-handle");

    await handle.trigger("pointerdown", { pointerId: 1, clientX: 1160 });
    expect(document.body.style.userSelect).toBe("none");

    // Closing the panel mid-drag (✕ / Esc) unmounts the handle with its
    // listeners — the restore must not depend on pointerup ever firing.
    wrapper.unmount();
    expect(document.body.style.userSelect).toBe("");
  });
});
