import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import AppSidebar, { type SidebarItem } from "./AppSidebar.vue";

const STORAGE_KEY = "vynel.sidebar.collapsed-groups";

const toolkit = { id: "toolkit", label: "Toolkit" };
const planner = { id: "planner", label: "Planner" };

function makeItems(): SidebarItem[] {
  return [
    { id: "home", label: "Home" },
    { id: "chat", label: "Chat" },
    { id: "agents", label: "Agents", group: toolkit },
    { id: "skills", label: "Skills", group: toolkit },
    { id: "plans", label: "Plans", group: planner },
    { id: "tasks", label: "Tasks", group: planner },
    { id: "marketplace", label: "Marketplace" },
  ];
}

function mountSidebar(
  items: SidebarItem[] = makeItems(),
  activeSectionId: string | null = null,
) {
  return mount(AppSidebar, {
    props: {
      sectionTitle: "Menu",
      sectionItems: items,
      activeSectionId,
      accountName: "Chad",
    },
  });
}

function rowLabels(wrapper: ReturnType<typeof mountSidebar>): string[] {
  return wrapper.findAll("ul button").map((button) => button.text());
}

function groupHeader(wrapper: ReturnType<typeof mountSidebar>, label: string) {
  const header = wrapper
    .findAll(".group-header")
    .find((button) => button.text() === label);
  if (header === undefined) throw new Error(`no group header "${label}"`);
  return header;
}

describe("AppSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders plain rows and grouped rows in catalog order, headers labeled", async () => {
    const wrapper = mountSidebar();

    expect(rowLabels(wrapper)).toEqual([
      "Home",
      "Chat",
      "Agents",
      "Skills",
      "Plans",
      "Tasks",
      "Marketplace",
    ]);
    expect(
      wrapper.findAll(".group-header").map((button) => button.text()),
    ).toEqual(["Toolkit", "Planner"]);
  });

  it("folding a group hides its rows, persists, and unfolding restores them", async () => {
    const wrapper = mountSidebar();

    await groupHeader(wrapper, "Toolkit").trigger("click");

    // Toolkit's rows are gone; plain rows and the other group stay.
    expect(rowLabels(wrapper)).toEqual([
      "Home",
      "Chat",
      "Plans",
      "Tasks",
      "Marketplace",
    ]);
    expect(groupHeader(wrapper, "Toolkit").attributes("aria-expanded")).toBe(
      "false",
    );
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(["toolkit"]);

    await groupHeader(wrapper, "Toolkit").trigger("click");
    expect(rowLabels(wrapper)).toContain("Agents");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it("starts folded from the persisted state", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["planner"]));

    const wrapper = mountSidebar();

    expect(rowLabels(wrapper)).not.toContain("Plans");
    expect(rowLabels(wrapper)).toContain("Agents");
  });

  it("a corrupt stored value falls back to everything open", () => {
    localStorage.setItem(STORAGE_KEY, "not json {");

    const wrapper = mountSidebar();

    expect(rowLabels(wrapper)).toContain("Agents");
    expect(rowLabels(wrapper)).toContain("Plans");
  });

  it("navigating to a section inside a folded group unfolds it", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["toolkit"]));

    const wrapper = mountSidebar();
    expect(rowLabels(wrapper)).not.toContain("Agents");

    await wrapper.setProps({ activeSectionId: "agents" });
    await nextTick();

    expect(rowLabels(wrapper)).toContain("Agents");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it("mounting with the active section already in a folded group unfolds it immediately", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["planner"]));

    const wrapper = mountSidebar(makeItems(), "plans");

    expect(rowLabels(wrapper)).toContain("Plans");
  });
});
