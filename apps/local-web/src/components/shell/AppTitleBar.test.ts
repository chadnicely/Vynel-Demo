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
      ...overrides,
    },
  });
}

// test: the workspace switcher moved off the title bar onto the tab strip
// (AppTabStrip) — the bar keeps identity, menus, title, and window controls.
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

  it("shows the window title", () => {
    const wrapper = mountTitleBar({ title: "Marketing" });
    expect(wrapper.text()).toContain("Marketing");
  });
});
