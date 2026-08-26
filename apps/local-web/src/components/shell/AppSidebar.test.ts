// The sidebar's one test suite. It was two files — `AppSidebar.test.ts` and
// `app-sidebar.test.ts` — differing only in case, which collides on a
// case-insensitive checkout (macOS default, most CI images). Merged 2026-08-15;
// every assertion from both survives, nothing was dropped.
//
// Two clusters: the row list itself (order, selection, counts, the account
// foot) and the expandable groups (fold state, persistence, auto-unfold).

import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { SessionStatusView } from "@vynel/contracts/chat/session-status";
import AppSidebar, { type SidebarItem } from "./AppSidebar.vue";

const STORAGE_KEY = "vynel.sidebar.collapsed-groups";

// The sidebar is ONE plain menu list (the segmented Home/Chat pill died with
// Chad's "no special menus" call) — the shell passes Home/Chat/Sessions as
// ordinary items at the top of sectionItems and marks the active row.
const PLAIN_SECTIONS: SidebarItem[] = [
  { id: "home", label: "Home" },
  { id: "chat", label: "Chat" },
  { id: "sessions", label: "Sessions" },
  { id: "channels", label: "Channels" },
  { id: "memory", label: "Memory" },
];

const toolkit = { id: "toolkit", label: "Toolkit" };
const planner = { id: "planner", label: "Planner" };

// Plain rows, then two groups, then a trailing plain row — the catalog shape
// the shell actually builds (Marketplace stays visible with all groups shut).
function makeGroupedItems(): SidebarItem[] {
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

function mountSidebar(overrides: Record<string, unknown> = {}) {
  return mount(AppSidebar, {
    props: {
      sectionTitle: "Menu",
      sectionItems: PLAIN_SECTIONS,
      activeSectionId: null,
      accountName: "Chad Subedi",
      ...overrides,
    },
  });
}

function menuButtons(wrapper: ReturnType<typeof mountSidebar>) {
  return wrapper.findAll("ul button");
}

function rowLabels(wrapper: ReturnType<typeof mountSidebar>): string[] {
  return menuButtons(wrapper).map((button) => button.text());
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

  describe("rows", () => {
    it("renders every menu item as a plain row, in order — no pill toggle", () => {
      const wrapper = mountSidebar();
      expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
      expect(rowLabels(wrapper)).toEqual([
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
      expect(wrapper.emitted("select-section")).toEqual([
        ["home"],
        ["channels"],
      ]);
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
      expect(rowLabels(wrapper)).toEqual(["Sessions13", "Agents0", "Memory"]);
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

  describe("groups", () => {
    it("renders plain rows and grouped rows in catalog order, headers labeled", () => {
      // Everything open — the user folded nothing back.
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
      const wrapper = mountSidebar({ sectionItems: makeGroupedItems() });

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

    // Chad, 2026-08-25: "it's really overwhelming". Every group open at once is
    // seventeen rows before you have done anything, so the real groups start
    // FOLDED. Headings and ungrouped rows (Marketplace) always show.
    it("starts folded on a fresh install — headings and ungrouped rows only", () => {
      const wrapper = mountSidebar({ sectionItems: makeGroupedItems() });

      // Toolkit is folded by default; Planner is not on the default list.
      expect(rowLabels(wrapper)).toEqual(["Home", "Chat", "Plans", "Tasks", "Marketplace"]);
      // Both headings are still there — folded, not hidden.
      expect(groupHeader(wrapper, "Toolkit").attributes("aria-expanded")).toBe("false");
      expect(groupHeader(wrapper, "Planner").attributes("aria-expanded")).toBe("true");
    });

    it("opening a folded group reveals its rows and remembers the choice", async () => {
      const wrapper = mountSidebar({ sectionItems: makeGroupedItems() });

      await groupHeader(wrapper, "Toolkit").trigger("click");

      expect(rowLabels(wrapper)).toContain("Agents");
      expect(rowLabels(wrapper)).toContain("Skills");
      expect(groupHeader(wrapper, "Toolkit").attributes("aria-expanded")).toBe("true");
      // The default is a starting point, not a rule — a group you open stays
      // open, so the stored set no longer holds it.
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).not.toContain("toolkit");
    });

    it("an empty stored set means everything OPEN — the user folded nothing back", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));

      const wrapper = mountSidebar({ sectionItems: makeGroupedItems() });

      expect(rowLabels(wrapper)).toContain("Agents");
      expect(rowLabels(wrapper)).toContain("Plans");
    });

    it("folding a group hides its rows, persists, and unfolding restores them", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
      const wrapper = mountSidebar({ sectionItems: makeGroupedItems() });

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
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([
        "toolkit",
      ]);

      await groupHeader(wrapper, "Toolkit").trigger("click");
      expect(rowLabels(wrapper)).toContain("Agents");
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
    });

    it("starts folded from the persisted state", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(["planner"]));

      const wrapper = mountSidebar({ sectionItems: makeGroupedItems() });

      expect(rowLabels(wrapper)).not.toContain("Plans");
      expect(rowLabels(wrapper)).toContain("Agents");
    });

    it("a corrupt stored value falls back to the folded default, not a wall of rows", () => {
      localStorage.setItem(STORAGE_KEY, "not json {");

      const wrapper = mountSidebar({ sectionItems: makeGroupedItems() });

      expect(rowLabels(wrapper)).not.toContain("Agents");
      expect(rowLabels(wrapper)).toContain("Plans");
      expect(rowLabels(wrapper)).toContain("Marketplace");
    });

    it("navigating to a section inside a folded group unfolds it", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(["toolkit"]));

      const wrapper = mountSidebar({ sectionItems: makeGroupedItems() });
      expect(rowLabels(wrapper)).not.toContain("Agents");

      await wrapper.setProps({ activeSectionId: "agents" });
      await nextTick();

      expect(rowLabels(wrapper)).toContain("Agents");
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
    });

    it("mounting with the active section already in a folded group unfolds it immediately", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(["planner"]));

      const wrapper = mountSidebar({
        sectionItems: makeGroupedItems(),
        activeSectionId: "plans",
      });

      expect(rowLabels(wrapper)).toContain("Plans");
    });
  });

  // A row with a CONVERSATION behind it (Voice chat) wears the Sessions row's
  // mark. The spoken thread had no status anywhere before session-hardening D2:
  // a voice turn that failed lit nothing in the whole app.
  describe("a conversation row's status mark", () => {
    function voiceRow(status: SessionStatusView): SidebarItem[] {
      return [
        { id: "chat", label: "Chat" },
        { id: "voice-chat", label: "Voice chat", status },
      ];
    }

    it("shows nothing for a plain section row", () => {
      const wrapper = mountSidebar();
      expect(wrapper.find(".sidebar-mark").exists()).toBe(false);
    });

    it("wears the state's mark and carries the assistant's why", () => {
      const wrapper = mountSidebar({
        sectionItems: voiceRow({
          status: "problem",
          note: "You've hit your session limit",
        }),
      });
      const mark = wrapper.find(".sidebar-mark");
      expect(mark.attributes("data-status")).toBe("problem");
      expect(mark.attributes("title")).toBe("You've hit your session limit");
      expect(mark.attributes("aria-label")).toBe("Voice chat hit a problem");
    });

    it("shows the live dot while a turn runs, not a mark", () => {
      const wrapper = mountSidebar({
        sectionItems: voiceRow({ status: "running", note: null }),
      });
      expect(wrapper.find(".sidebar-mark").exists()).toBe(false);
      expect(wrapper.find('[aria-label="Voice chat is working"]').exists()).toBe(true);
    });

    it("shows nothing while the thread is idle", () => {
      const wrapper = mountSidebar({
        sectionItems: voiceRow({ status: "idle", note: null }),
      });
      expect(wrapper.find(".sidebar-mark").exists()).toBe(false);
    });
  });
});

// The drilled workspace card wears the workspace's own logo when one was
// uploaded — the same face the tree row shows — and its monogram otherwise
// (Kafi, 2026-08-22: one logo everywhere).
describe("AppSidebar workspace card face", () => {
  const card = {
    name: "letterman",
    statusLine: "Nothing running",
    statusTone: "not_running" as const,
    initials: "LE",
  };

  it("shows the logo as-is when the workspace has one", () => {
    const wrapper = mountSidebar({
      sectionItems: PLAIN_SECTIONS,
      workspaceCard: { ...card, imageUrl: "data:image/png;base64,AAAA" },
    });
    const face = wrapper.get(".workspace-card-face");
    expect(face.find("img").attributes("src")).toBe("data:image/png;base64,AAAA");
    expect(face.text()).toBe("");
  });

  it("falls back to the monogram on the accent", () => {
    const wrapper = mountSidebar({
      sectionItems: PLAIN_SECTIONS,
      workspaceCard: { ...card, imageUrl: null },
    });
    const face = wrapper.get(".workspace-card-face");
    expect(face.find("img").exists()).toBe(false);
    expect(face.text()).toBe("LE");
  });
});
