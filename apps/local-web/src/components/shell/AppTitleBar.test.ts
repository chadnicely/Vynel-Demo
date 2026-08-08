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
// test: correct expectation — the bar slimmed to TWO menus (Chad, 2026-07-24):
// Assistant folded away (New workspace lives under Vynel; the rest is palette
// territory) and Go died (the tab strip + sidebar are the navigation).
describe("AppTitleBar", () => {
  it("renders the two-menu bar and window controls", () => {
    const wrapper = mountTitleBar();
    const menuLabels = wrapper
      .findAll("nav button")
      .map((b) => b.text());
    expect(menuLabels).toEqual(["Vynel", "View"]);

    for (const label of ["Minimize", "Maximize", "Close"]) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true);
    }
  });

  it("shows the window title", () => {
    const wrapper = mountTitleBar({ title: "Marketing" });
    expect(wrapper.text()).toContain("Marketing");
  });

  // test: correct expectation — the presence pair is PASSIVE now (redesign
  // Q7d): the working rail carries the detail; the pair renders no button and
  // clicking it commands nothing.
  it("the presence pair is passive — no command behind it (redesign Q7d)", async () => {
    const wrapper = mountTitleBar();
    const presence = wrapper.get('[data-testid="titlebar-presence"]');
    expect(presence.element.tagName).not.toBe("BUTTON");
    await presence.trigger("click");
    expect(wrapper.emitted("command")).toBeUndefined();
  });
});
