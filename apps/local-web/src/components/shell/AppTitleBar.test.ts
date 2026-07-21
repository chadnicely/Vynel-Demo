import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppTitleBar from "./AppTitleBar.vue";

function mountTitleBar(overrides: Record<string, unknown> = {}) {
  return mount(AppTitleBar, {
    props: {
      title: "Global chat",
      presenceState: "idle",
      presenceLabel: "assistant idle",
      theme: "dark",
      sidebarOpen: true,
      tasksOpen: false,
      openTaskCount: 0,
      workspaces: [{ id: "w1", name: "vynel" }],
      activeWorkspaceId: null,
      ...overrides,
    },
  });
}

describe("AppTitleBar", () => {
  it("renders the menu bar and window controls", () => {
    const wrapper = mountTitleBar();
    const menuLabels = wrapper
      .findAll("nav button")
      .map((b) => b.text());
    expect(menuLabels).toEqual(["Vynel", "Assistant", "View", "Go"]);

    for (const label of ["Minimize", "Maximize", "Close"]) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true);
    }
  });

  it("shows the global scope in the switcher when no workspace is active", () => {
    const wrapper = mountTitleBar({ activeWorkspaceId: null });
    expect(wrapper.text()).toContain("Global chat");
  });

  it("shows the active workspace name in the switcher", () => {
    const wrapper = mountTitleBar({ activeWorkspaceId: "w1" });
    expect(wrapper.text()).toContain("vynel");
  });
});
