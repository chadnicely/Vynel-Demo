import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { DropdownMenu } from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
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

// The dropdowns portal their rows out of the wrapper and reka's trigger
// ignores jsdom's synthetic pointer events, so the bar's menus are pinned
// through the model it hands DropdownMenu — the rendering of a checkbox row
// is DropdownMenu's own test.
function viewMenu(wrapper: ReturnType<typeof mountTitleBar>) {
  return wrapper
    .findAllComponents(DropdownMenu)
    .find((menu) => menu.text().includes("View"))!;
}
function viewMenuItems(wrapper: ReturnType<typeof mountTitleBar>): MenuItemModel[] {
  return viewMenu(wrapper).props("items");
}

// test: the workspace switcher moved off the title bar onto the tab strip
// (AppTabStrip) — the bar keeps identity, menus, and window controls.
// test: correct expectation — the bar slimmed to TWO menus (Chad, 2026-07-24):
// Assistant folded away (New workspace lives under Vynel; the rest is palette
// territory) and Go died (the tab strip + sidebar are the navigation).
describe("AppTitleBar", () => {
  // test: correct expectation — Nodes joined the menu row (2026-08-15). It is
  // a direct link rather than a menu, so it is a third `nav button` beside the
  // two dropdown triggers, not a third dropdown.
  it("renders the two menus plus the Nodes link, and window controls", () => {
    const wrapper = mountTitleBar();
    const menuLabels = wrapper
      .findAll("nav button")
      .map((b) => b.text());
    expect(menuLabels).toEqual(["Vynel", "View", "Nodes"]);

    for (const label of ["Minimize", "Maximize", "Close"]) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true);
    }
  });

  // test: correct expectation (2026-08-14 pixel pass) — title AND presence
  // dot both retired; the canvas's bar center is a bare drag region.
  // Updated 2026-08-15 for the Nodes link's word.
  it("carries no title and no presence pair — the center is empty", () => {
    const wrapper = mountTitleBar();
    expect(wrapper.find('[data-testid="titlebar-presence"]').exists()).toBe(false);
    // Only the menu row carries text — nothing else. The bar names no scope:
    // the chat header and the tree already say where you are.
    // test: correct expectation — the Tabs|Menu segment moved into the View
    // menu (Kafi, 2026-08-21); was "VynelViewNodesTabsMenu".
    expect(wrapper.text().replace(/\s+/g, "")).toBe("VynelViewNodes");
  });

  it("the Nodes word commands open-nodes", async () => {
    const wrapper = mountTitleBar();
    const nodes = wrapper.findAll("nav button").find((b) => b.text() === "Nodes");
    await nodes!.trigger("click");
    expect(wrapper.emitted("command")).toEqual([["open-nodes"]]);
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

  // The provider mark (Kafi, 2026-08-18): the Claude account popup's door,
  // first of the bar's right cluster.
  it("the provider mark commands claude-account", async () => {
    const wrapper = mountTitleBar();
    await wrapper.get('[aria-label="Claude account"]').trigger("click");
    expect(wrapper.emitted("command")).toEqual([["claude-account"]]);
  });

  // The navigation pick lives in the View menu now (Kafi, 2026-08-21) — both
  // views named, the live one ticked, above "Show navigation".
  it("the View menu leads with the Tabs/Menu pick, ticked on the live view", () => {
    const items = viewMenuItems(mountTitleBar({ navMode: "menu" }));

    expect(items.slice(0, 3).map((item) => [item.id, item.label, item.checked])).toEqual([
      ["nav-tabs", "Tabs", false],
      ["nav-menu", "Menu", true],
      ["sep-3", undefined, undefined],
    ]);
    // The pick sits directly above the navigation toggle it belongs beside.
    expect(items[3]!.id).toBe("toggle-sidebar");
  });

  it("the tick follows the live view", () => {
    const items = viewMenuItems(mountTitleBar({ navMode: "tabs" }));
    expect(items.slice(0, 2).map((item) => item.checked)).toEqual([true, false]);
  });

  it("picking a navigation view commands its mode", async () => {
    const wrapper = mountTitleBar({ navMode: "menu" });

    viewMenu(wrapper).vm.$emit("toggle", "nav-tabs", true);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("command")).toEqual([["nav-tabs"]]);
  });
});
