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
        { id: "global", workspaceId: null },
        { id: "t1", workspaceId: "w1" },
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
        { id: "global", workspaceId: null },
        { id: "t9", workspaceId: "gone" },
      ],
    });

    expect(tabName(wrapper.findAll('[role="tab"]')[1]!)).toBe("Workspace");
  });

  it("offers the add-tab menu trigger and a per-tab workspace switcher", () => {
    const wrapper = mountStrip();

    expect(wrapper.find('[aria-label="New tab"]').exists()).toBe(true);
    expect(
      wrapper.find('[aria-label="Switch workspace for Marketing"]').exists(),
    ).toBe(true);
  });
});
