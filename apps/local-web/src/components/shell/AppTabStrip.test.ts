import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppTabStrip from "./AppTabStrip.vue";

const WORKSPACES = [
  { id: "w1", name: "Marketing" },
  { id: "w2", name: "Bakery" },
];

function mountStrip(overrides: Record<string, unknown> = {}) {
  return mount(AppTabStrip, {
    props: {
      tabs: [
        { id: "global", workspaceId: null, colorSlot: null },
        { id: "t1", workspaceId: "w1", colorSlot: null },
      ],
      activeTabId: "global",
      workspaces: WORKSPACES,
      ...overrides,
    },
  });
}

/** A tab's visible name — the label span, without the monogram initials. */
function tabName(tab: { find: (selector: string) => { text: () => string } }) {
  return tab.find(".truncate").text();
}

describe("AppTabStrip", () => {
  it("renders the pinned Global tab first, then workspace tabs by name", () => {
    const wrapper = mountStrip();

    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map(tabName)).toEqual(["Global", "Marketing"]);
  });

  it("marks the active tab selected", () => {
    const wrapper = mountStrip({ activeTabId: "t1" });

    const selected = wrapper
      .findAll('[role="tab"]')
      .filter((tab) => tab.attributes("aria-selected") === "true");
    expect(selected.map(tabName)).toEqual(["Marketing"]);
  });

  it("clicking a tab emits select-tab", async () => {
    const wrapper = mountStrip();

    await wrapper.findAll('[role="tab"]')[1]!.trigger("click");

    expect(wrapper.emitted("select-tab")).toEqual([["t1"]]);
  });

  it("the Global tab has no close button; a workspace tab does", async () => {
    const wrapper = mountStrip();

    const closeButtons = wrapper.findAll('[aria-label^="Close"]');
    expect(closeButtons).toHaveLength(1);

    await closeButtons[0]!.trigger("click");
    expect(wrapper.emitted("close-tab")).toEqual([["t1"]]);
  });

  it("a stale workspace id still renders a tab (as plain Workspace)", () => {
    const wrapper = mountStrip({
      tabs: [
        { id: "global", workspaceId: null, colorSlot: null },
        { id: "t9", workspaceId: "gone", colorSlot: null },
      ],
    });

    expect(tabName(wrapper.findAll('[role="tab"]')[1]!)).toBe("Workspace");
  });

  it("tabs are uniform width — Global and rooms alike", () => {
    const wrapper = mountStrip();

    const containers = wrapper.findAll('[role="tablist"] > .group');
    expect(containers).toHaveLength(2);
    for (const container of containers) {
      expect(container.classes()).toContain("w-44");
    }
  });

  it("a user-picked color slot paints the tab over the auto accent", () => {
    const wrapper = mountStrip({
      tabs: [
        { id: "global", workspaceId: null, colorSlot: null },
        { id: "t1", workspaceId: "w1", colorSlot: 3 },
      ],
      activeTabId: "t1",
    });

    const roomTab = wrapper.findAll('[role="tab"]')[1]!;
    expect(roomTab.find("span").attributes("style")).toContain("--ws-3");
  });

  it("offers the add-tab menu trigger and a per-tab workspace switcher", () => {
    const wrapper = mountStrip();

    expect(wrapper.find('[aria-label="New tab"]').exists()).toBe(true);
    expect(
      wrapper.find('[aria-label="Switch workspace for Marketing"]').exists(),
    ).toBe(true);
  });
});
