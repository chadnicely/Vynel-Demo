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

  // test: correct expectation (Arc 5b browser tabs) — tabs size to their
  // name (max-width capped in CSS); the active one wears the canvas ground.
  it("the active tab wears is-active; resting tabs stay plain", () => {
    const wrapper = mountStrip({ activeTabId: "t1" });

    const containers = wrapper.findAll('[role="tablist"] > .app-tab');
    expect(containers).toHaveLength(2);
    expect(containers[1]!.classes()).toContain("is-active");
    expect(containers[0]!.classes()).not.toContain("is-active");
  });

  it("a user-picked color slot paints the active tab's bottom edge", () => {
    const wrapper = mountStrip({
      tabs: [
        { id: "global", workspaceId: null, colorSlot: null },
        { id: "t1", workspaceId: "w1", colorSlot: 3 },
      ],
      activeTabId: "t1",
    });

    const roomTab = wrapper.findAll('[role="tablist"] > .app-tab')[1]!;
    expect(roomTab.attributes("style")).toContain("--ws-3");
  });

  // The status vocabulary on the strip (Arc 5b): running spins the chip, a
  // set state wears the pulsing one-colour mark, parked tabs dim.
  it("status views drive the chip, the mark dot, and the parked dim", () => {
    const wrapper = mountStrip({
      tabs: [
        { id: "global", workspaceId: null, colorSlot: null },
        { id: "t1", workspaceId: "w1", colorSlot: null },
        { id: "t2", workspaceId: "w2", colorSlot: null },
      ],
      activeTabId: "t1",
      statusByWorkspaceId: {
        w1: { status: "running", note: null, tasksDone: 1, tasksTotal: 3 },
        w2: { status: "problem", note: null, tasksDone: 1, tasksTotal: 3 },
      },
    });

    const tabs = wrapper.findAll('[role="tablist"] > .app-tab');
    expect(tabs[1]!.find(".animate-spin").exists()).toBe(true);
    expect(tabs[2]!.find('.tab-mark[data-status="problem"]').exists()).toBe(true);
    // The inactive Global tab (nothing running there) reads parked and dims.
    expect(tabs[0]!.classes()).toContain("is-parked");
  });

  it("offers the add-tab menu trigger and a per-tab workspace switcher", () => {
    const wrapper = mountStrip();

    expect(wrapper.find('[aria-label="New tab"]').exists()).toBe(true);
    expect(
      wrapper.find('[aria-label="Switch workspace for Marketing"]').exists(),
    ).toBe(true);
  });
});
