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
  // test: correct expectation — the Nodes word (2026-08-15) left the menu row
  // on 2026-08-22 (the view switch's Nodes segment is its one door) and the
  // Settings menu joined, between Vynel and View (Kafi).
  it("renders the four menus and the window controls", () => {
    const wrapper = mountTitleBar();
    const menuLabels = wrapper
      .findAll("nav button")
      .map((b) => b.text());
    expect(menuLabels).toEqual(["Vynel", "Settings", "View", "Admin"]);

    for (const label of ["Minimize", "Maximize", "Close"]) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true);
    }
  });

  // test: correct expectation (2026-08-14 pixel pass) — title AND presence
  // dot both retired; the canvas's bar center is a bare drag region.
  it("carries no title and no presence pair — the center is empty", () => {
    const wrapper = mountTitleBar();
    expect(wrapper.find('[data-testid="titlebar-presence"]').exists()).toBe(false);
    // Only the menu row carries text — nothing else. The bar names no scope:
    // the chat header and the tree already say where you are.
    // test: correct expectation — was "VynelViewNodes" until the Nodes word
    // became the switch's icon and Settings joined (2026-08-22).
    expect(wrapper.text().replace(/\s+/g, "")).toBe("VynelSettingsViewAdmin");
  });

  // The demo kit was reachable only by command palette or a typed URL. Admin
  // is its visible door — the surfaces you run the product FROM — and it sends
  // the same command the palette already sent.
  it("opens Admin on one click — a door, not a dropdown", async () => {
    const wrapper = mountTitleBar();
    const admin = wrapper.findAll("nav button").find((b) => b.text() === "Admin")!;

    await admin.trigger("click");

    expect(wrapper.emitted("command")).toEqual([["open-demo-scripts"]]);
  });

  // Admin is an ordinary page: the menu row is exactly what every other
  // screen shows, with Admin beside it.
  it("keeps the whole menu row on Admin — it is a page like any other", () => {
    const wrapper = mountTitleBar({ adminOn: true });

    expect(wrapper.findAll("nav button").map((b) => b.text())).toEqual([
      "Vynel",
      "Settings",
      "View",
      "Admin",
    ]);
  });

  it("marks Admin as the current page while it is the screen on show", () => {
    expect(
      mountTitleBar({ adminOn: true })
        .findAll("nav button")
        .find((b) => b.text() === "Admin")!
        .attributes("aria-current"),
    ).toBe("page");
  });

  // ONE voice control replaced the three-glyph switch (Chad, 2026-08-28);
  // the modes it carried are words in the View menu now.
  it("offers the view modes as words in the View menu", () => {
    const ids = viewMenuItems(mountTitleBar({ viewMode: "nodes" })).map((item) => item.id);
    expect(ids).toContain("open-nodes");
    expect(ids).toContain("view-display");
    expect(ids).toContain("view-normal");
  });

  it("collapses to the corner cluster in full view", () => {
    const wrapper = mountTitleBar({ viewMode: "nodes", fullView: true });
    expect(wrapper.find("nav").exists()).toBe(false);
    expect(wrapper.find('[aria-label="Toggle tasks"]').exists()).toBe(false);
    expect(wrapper.text().replace(/\s+/g, "")).toBe("");
    // The cluster is identity plus the window controls: the view glyphs
    // became words in the View menu, and the voice needs no button — the
    // daemon's wake leg listens on its own.
    for (const label of ["Claude account", "Minimize", "Maximize", "Close"]) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true);
    }
    expect(wrapper.classes()).toContain("absolute");
  });

  // Over the Display the cluster wears the Display's palette — the chrome greys
  // would vanish into its ground. Over the Nodes screen it stays chrome.
  it("wears the Display palette only over the Display's full view", () => {
    expect(
      mountTitleBar({ viewMode: "display", fullView: true }).classes(),
    ).toContain("display-palette");
    expect(
      mountTitleBar({ viewMode: "nodes", fullView: true }).classes(),
    ).not.toContain("display-palette");
    expect(mountTitleBar({ viewMode: "display" }).classes()).not.toContain(
      "display-palette",
    );
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

  // The Settings menu (Kafi, 2026-08-22): this computer's machine-level
  // screens, moved here from the sidebar, each row a section id the shell
  // routes like any global section. Application keeps the Ctrl+, hint.
  // Desktop control joined the local-machine group (2026-08-23) — it decides
  // whether Vynel may act on THIS computer, so it sits with Embedding/Voice.
  it("the Settings menu carries the machine-level screens in order", async () => {
    const wrapper = mountTitleBar();
    const settings = wrapper
      .findAllComponents(DropdownMenu)
      .find((menu) => menu.text().includes("Settings"))!;
    const items: MenuItemModel[] = settings.props("items");
    expect(items.filter((item) => item.kind !== "separator").map((item) => [item.id, item.label])).toEqual([
      ["embedding", "Embedding"],
      ["voice-settings", "Voice"],
      ["desktop-control", "Desktop control"],
      // test: correct expectation — Settings → GitHub (2026-08-23), the app's
      // one sign-in over the gh CLI.
      ["github", "GitHub"],
      ["engine", "Where Vynel runs"],
      ["application", "Application"],
    ]);

    settings.vm.$emit("select", "voice-settings");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("command")).toEqual([["voice-settings"]]);
  });

  // About Vynel (2026-08-27): the version + update door lives in the app's
  // own menu above Quit — the standard place every desktop app keeps it.
  it("the Vynel menu carries About Vynel above Quit, and emits it", async () => {
    const wrapper = mountTitleBar();
    const vynel = wrapper
      .findAllComponents(DropdownMenu)
      .find((menu) => menu.text().includes("Vynel"))!;
    const items: MenuItemModel[] = vynel.props("items");
    expect(items.filter((item) => item.kind !== "separator").map((item) => [item.id, item.label])).toEqual([
      ["new-workspace", "New workspace"],
      ["account", "Account"],
      ["about", "About Vynel"],
      ["quit", "Quit Vynel"],
    ]);

    vynel.vm.$emit("select", "about");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("command")).toEqual([["about"]]);
  });

  it("choosing Desktop control emits it as a shell command", async () => {
    const wrapper = mountTitleBar();
    const settings = wrapper
      .findAllComponents(DropdownMenu)
      .find((menu) => menu.text().includes("Settings"))!;
    settings.vm.$emit("select", "desktop-control");
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("command")).toEqual([["desktop-control"]]);
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
