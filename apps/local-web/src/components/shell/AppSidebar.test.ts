import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppSidebar from "./AppSidebar.vue";

const sections = [
  { id: "channels", label: "Channels" },
  { id: "memory", label: "Memory" },
];

function mountSidebar(overrides: Record<string, unknown> = {}) {
  return mount(AppSidebar, {
    props: {
      surface: "chat",
      sectionTitle: "Menu",
      sectionItems: sections,
      activeSectionId: null,
      accountName: "Chad Subedi",
      ...overrides,
    },
  });
}

describe("AppSidebar", () => {
  it("renders the Home/Chat/Sessions toggle and marks the active surface", () => {
    const wrapper = mountSidebar({ surface: "chat" });
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map((t) => t.text())).toEqual(["Home", "Chat", "Sessions"]);
    const active = tabs.filter((t) => t.attributes("aria-selected") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]!.text()).toBe("Chat");
  });

  it("marks the Sessions toggle on the sessions surface", () => {
    const wrapper = mountSidebar({ surface: "sessions" });
    const active = wrapper
      .findAll('[role="tab"]')
      .filter((t) => t.attributes("aria-selected") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]!.text()).toBe("Sessions");
  });

  it("selects neither toggle inside a workspace", () => {
    const wrapper = mountSidebar({ surface: "workspace" });
    const active = wrapper
      .findAll('[role="tab"]')
      .filter((t) => t.attributes("aria-selected") === "true");
    expect(active).toHaveLength(0);
  });

  it("emits select-surface when a toggle is clicked", async () => {
    const wrapper = mountSidebar();
    await wrapper.findAll('[role="tab"]')[0]!.trigger("click");
    expect(wrapper.emitted("select-surface")).toEqual([["home"]]);
  });

  it("renders sections and emits select-section on click", async () => {
    const wrapper = mountSidebar();
    const sectionButtons = wrapper
      .findAll("button")
      .filter((b) => ["Channels", "Memory"].includes(b.text()));
    expect(sectionButtons).toHaveLength(2);
    await sectionButtons[0]!.trigger("click");
    expect(wrapper.emitted("select-section")).toEqual([["channels"]]);
  });

  it("emits open-account from the account row", async () => {
    const wrapper = mountSidebar();
    const account = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Chad Subedi"));
    await account!.trigger("click");
    expect(wrapper.emitted("open-account")).toHaveLength(1);
  });
});
