import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppTitleBar from "./AppTitleBar.vue";

function mountTitleBar(overrides: Record<string, unknown> = {}) {
  return mount(AppTitleBar, {
    props: {
      theme: "dark",
      navMode: "tabs",
      sidebarOpen: true,
      tasksOpen: false,
      ...overrides,
    },
  });
}

// test: the workspace switcher moved off the title bar onto the tab strip
// (AppTabStrip) — the bar keeps identity, menus, and window controls.
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

  // test: correct expectation (2026-08-14 pixel pass) — title AND presence
  // dot both retired; the canvas's bar center is a bare drag region.
  it("carries no title and no presence pair — the center is empty", () => {
    const wrapper = mountTitleBar();
    expect(wrapper.find('[data-testid="titlebar-presence"]').exists()).toBe(false);
    // Only the menus + the nav segment carry text — nothing else. The bar
    // names no scope: the chat header and the tree already say where you are.
    expect(wrapper.text().replace(/\s+/g, "")).toBe("VynelViewTabsMenu");
  });

  // A workspace puts the rail toggle beside its own files toggle, so the bar
  // must not carry a second one.
  it("drops the tasks glyph where the scope has its own pane tools", () => {
    expect(
      mountTitleBar({ showsTasksToggle: false })
        .find('[aria-label="Toggle tasks"]')
        .exists(),
    ).toBe(false);
  });

  // The rail toggle rides WITH the folder chip — the rail is this scope's
  // work, so it sits beside the scope, not among the window controls.
  it("the tasks glyph commands toggle-tasks", async () => {
    const wrapper = mountTitleBar();
    await wrapper.get('[aria-label="Toggle tasks"]').trigger("click");
    expect(wrapper.emitted("command")).toEqual([["toggle-tasks"]]);
  });
});
