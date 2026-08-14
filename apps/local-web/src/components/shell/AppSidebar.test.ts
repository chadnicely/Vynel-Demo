import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AppSidebar from "./AppSidebar.vue";

// The sidebar is ONE plain menu list (the segmented Home/Chat pill died with
// Chad's "no special menus" call) — the shell passes Home/Chat/Sessions as
// ordinary items at the top of sectionItems and marks the active row.
const sections = [
  { id: "home", label: "Home" },
  { id: "chat", label: "Chat" },
  { id: "sessions", label: "Sessions" },
  { id: "channels", label: "Channels" },
  { id: "memory", label: "Memory" },
];

function mountSidebar(overrides: Record<string, unknown> = {}) {
  return mount(AppSidebar, {
    props: {
      sectionTitle: "Menu",
      sectionItems: sections,
      activeSectionId: null,
      accountName: "Chad Subedi",
      ...overrides,
    },
  });
}

function menuButtons(wrapper: ReturnType<typeof mountSidebar>) {
  return wrapper.findAll("ul button");
}

describe("AppSidebar", () => {
  it("renders every menu item as a plain row, in order — no pill toggle", () => {
    const wrapper = mountSidebar();
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
    expect(menuButtons(wrapper).map((b) => b.text())).toEqual([
      "Home",
      "Chat",
      "Sessions",
      "Channels",
      "Memory",
    ]);
  });

  it("marks the active row with aria-current", () => {
    const wrapper = mountSidebar({ activeSectionId: "sessions" });
    const current = menuButtons(wrapper).filter(
      (b) => b.attributes("aria-current") === "page",
    );
    expect(current).toHaveLength(1);
    expect(current[0]!.text()).toBe("Sessions");
  });

  it("marks nothing when no row is active", () => {
    const wrapper = mountSidebar({ activeSectionId: null });
    const current = menuButtons(wrapper).filter(
      (b) => b.attributes("aria-current") === "page",
    );
    expect(current).toHaveLength(0);
  });

  it("emits select-section for any row, surface items included", async () => {
    const wrapper = mountSidebar();
    const buttons = menuButtons(wrapper);
    await buttons[0]!.trigger("click");
    await buttons[3]!.trigger("click");
    expect(wrapper.emitted("select-section")).toEqual([["home"], ["channels"]]);
  });

  it("shows a section's count when one is given, and NOTHING when it is absent", () => {
    // The canvas's right-hand numbers. An absent count must not render a bare
    // 0 — "no honest count" and "empty" are different facts.
    const wrapper = mountSidebar({
      sectionItems: [
        { id: "sessions", label: "Sessions", count: 13 },
        { id: "agents", label: "Agents", count: 0 },
        { id: "memory", label: "Memory" },
      ],
    });
    expect(menuButtons(wrapper).map((b) => b.text())).toEqual([
      "Sessions13",
      "Agents0",
      "Memory",
    ]);
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
