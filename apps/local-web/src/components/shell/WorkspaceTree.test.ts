// Tests for the workspace tree's folder interactions — the inline rename
// (focus via the v-for ARRAY ref — the exact break a scalar ref caused) and
// the drag-drop membership emits. Mounted directly: the reka-ui context
// menu is exercised in @vynel/ui's own tests; the double-click path drives
// the same startRename.

import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import WorkspaceTree from "./WorkspaceTree.vue";

// Two groups + two ungrouped rows. Every row keeps its place whatever its
// state — Blog is parked (quiet, nothing open) and still sits at the root.
function mountTree() {
  return mount(WorkspaceTree, {
    props: {
      workspaces: [
        { id: "ws-a", name: "Acme", groupId: "grp-1" },
        { id: "ws-c", name: "Cove", groupId: "grp-1" },
        { id: "ws-b", name: "Blog", groupId: null },
        { id: "ws-d", name: "Dune", groupId: null },
      ],
      groups: [
        { id: "grp-1", name: "Clients" },
        { id: "grp-2", name: "Side" },
      ],
      activeWorkspaceId: null,
      statusByWorkspaceId: {
        "ws-a": { status: "running" as const, note: null, tasksDone: 1, tasksTotal: 3 },
        "ws-b": { status: "not_running" as const, note: null, tasksDone: 0, tasksTotal: 0 },
      },
      globalStatus: "not_running" as const,
      accountName: "Sam",
    },
    attachTo: document.body,
  });
}

describe("WorkspaceTree", () => {
  beforeEach(() => localStorage.clear());

  it("double-clicking a folder name opens a focused rename input; Enter emits", async () => {
    const wrapper = mountTree();

    const label = wrapper
      .findAll("span")
      .find((node) => node.text() === "Clients");
    await label!.trigger("dblclick");
    await nextTick();

    const input = wrapper.find('input[aria-label="Rename Clients"]');
    expect(input.exists()).toBe(true);
    // The focus/select the scalar ref silently broke — pinned for real.
    await nextTick();
    expect(document.activeElement).toBe(input.element);

    await input.setValue("  Retainers  ");
    await input.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("rename-group")).toEqual([["grp-1", "Retainers"]]);
    wrapper.unmount();
  });

  it("Escape cancels a rename without emitting", async () => {
    const wrapper = mountTree();
    const label = wrapper
      .findAll("span")
      .find((node) => node.text() === "Clients");
    await label!.trigger("dblclick");
    await nextTick();

    const input = wrapper.find('input[aria-label="Rename Clients"]');
    await input.setValue("Nope");
    await input.trigger("keydown", { key: "Escape" });

    expect(wrapper.emitted("rename-group")).toBeUndefined();
    expect(wrapper.find('input[aria-label="Rename Clients"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("creating lives in the strip above Global and on each group", async () => {
    const wrapper = mountTree();

    // The strip sits ABOVE the Global row.
    const html = wrapper.html();
    expect(html.indexOf("tree-create-strip")).toBeLessThan(html.indexOf("Global"));

    // Strip: group first, then workspace (Kafi) — a new group, a new workspace at the root.
    const strip = wrapper.find(".tree-create-strip").html();
    expect(strip.indexOf("tree-new-group")).toBeLessThan(strip.indexOf("tree-new-workspace"));
    await wrapper.find("button.tree-new-group").trigger("click");
    expect(wrapper.emitted("create-group")).toHaveLength(1);
    await wrapper.find("button.tree-new-workspace").trigger("click");
    expect(wrapper.emitted("create-workspace")).toEqual([[null]]);

    // A group's own "+" pre-files the new workspace into it.
    await wrapper.find('[aria-label="New workspace in Clients"]').trigger("click");
    expect(wrapper.emitted("create-workspace")).toEqual([[null], ["grp-1"]]);
    wrapper.unmount();
  });

  it("a group the host just made opens straight into its rename box once its row is on screen", async () => {
    const wrapper = mountTree();

    // A group arriving on its own (another window, the dialog) opens nothing.
    await wrapper.setProps({
      groups: [
        { id: "grp-1", name: "Clients" },
        { id: "grp-2", name: "New group" },
      ],
    });
    await nextTick();
    expect(wrapper.find('input[aria-label="Rename New group"]').exists()).toBe(false);

    // The host names the one it created for the user → rename box, focused.
    await wrapper.setProps({ renameGroupId: "grp-2" });
    await nextTick();
    await nextTick();
    const input = wrapper.find('input[aria-label="Rename New group"]');
    expect(input.exists()).toBe(true);
    expect(document.activeElement).toBe(input.element);

    // Once per id: closing the box and re-rendering the groups doesn't reopen it.
    await input.trigger("keydown", { key: "Escape" });
    await wrapper.setProps({
      groups: [
        { id: "grp-1", name: "Clients" },
        { id: "grp-2", name: "New group" },
        { id: "grp-3", name: "Other" },
      ],
    });
    await nextTick();
    expect(wrapper.find('input[aria-label="Rename New group"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("group members sit a step in; ungrouped rows stay flush left", () => {
    const wrapper = mountTree();
    const memberList = wrapper.findAll("ul").find((list) => list.text().includes("Acme"))!;
    expect(memberList.classes()).toContain("pl-3");
    const rootList = wrapper.findAll("ul").find((list) => list.text().includes("Blog"))!;
    expect(rootList.classes()).not.toContain("pl-3");
    wrapper.unmount();
  });

  it("a row wears the workspace's icon on the left and its state on the right", async () => {
    const wrapper = mountTree();
    const acmeRow = wrapper
      .findAll('[draggable="true"]')
      .find((node) => node.text().includes("Acme"))!;
    // Monogram in the icon slot (no image given) …
    expect(acmeRow.find(".tree-icon").text()).toBe("AC");
    // … and the running spinner in the state cluster, after the name.
    const running = acmeRow.find('[aria-label="Working"]');
    expect(running.exists()).toBe(true);
    const html = acmeRow.html();
    expect(html.indexOf("Acme")).toBeLessThan(html.indexOf('aria-label="Working"'));

    // A parked room shows the play glyph, no spinner.
    const blogRow = wrapper
      .findAll('[draggable="true"]')
      .find((node) => node.text().includes("Blog"))!;
    expect(blogRow.find('[aria-label="Working"]').exists()).toBe(false);
    wrapper.unmount();
  });

  // A dragover with a pointer position: the tree reads which half of the
  // hovered element it's in. happy-dom rects are all zeros, so the target's
  // box is pinned to 30px tall and the pointer placed by hand.
  function dragOverAt(element: Element, clientY: number) {
    (element as HTMLElement).getBoundingClientRect = () =>
      ({ top: 0, height: 30, bottom: 30, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clientY", { value: clientY });
    element.dispatchEvent(event);
  }
  function rowOf(wrapper: ReturnType<typeof mountTree>, name: string) {
    return wrapper.findAll('[draggable="true"]').find((node) => node.text().includes(name))!;
  }
  function slotOf(wrapper: ReturnType<typeof mountTree>, name: string) {
    return wrapper.findAll("li.tree-slot").find((node) => node.text().includes(name))!;
  }
  function headerOf(wrapper: ReturnType<typeof mountTree>, name: string) {
    return wrapper.findAll(".tree-group-header").find((node) => node.text().includes(name))!;
  }
  // The tree is controlled: a drop EMITS the new order and the host hands it
  // back as `treeOrder`. These read the last emitted order and, where the
  // test checks the DOM, feed it back the way AppShell does.
  function emittedOrder(wrapper: ReturnType<typeof mountTree>) {
    const events = wrapper.emitted("order-change") ?? [];
    return events[events.length - 1]?.[0] as
      | { groups: string[]; workspaces: Record<string, string[]> }
      | undefined;
  }
  async function feedBackOrder(wrapper: ReturnType<typeof mountTree>) {
    await wrapper.setProps({ treeOrder: emittedOrder(wrapper) ?? null });
  }

  it("parked rows stay exactly where they are — no NOT RUNNING group", () => {
    const wrapper = mountTree();
    expect(wrapper.text()).not.toContain("Not running");
    // Blog (parked) still lists at the root, in server order, dimmed.
    const rootNames = wrapper
      .findAll("ul.tree-root li.tree-slot")
      .map((node) => node.find(".truncate").text());
    expect(rootNames).toEqual(["Blog", "Dune"]);
    wrapper.unmount();
  });

  it("dropping a row on a group's header joins that group (last); its own group is a no-op emit", async () => {
    const wrapper = mountTree();

    await rowOf(wrapper, "Blog").trigger("dragstart");
    await headerOf(wrapper, "Clients").trigger("dragover");
    await wrapper.find(".tree-group").trigger("drop");
    expect(wrapper.emitted("move-workspace")).toEqual([["ws-b", "grp-1"]]);
    expect(emittedOrder(wrapper)?.workspaces["grp-1"]).toEqual(["ws-a", "ws-c", "ws-b"]);

    // Dragging a member (Acme) onto its own group's header must not emit.
    await rowOf(wrapper, "Acme").trigger("dragstart");
    await headerOf(wrapper, "Clients").trigger("dragover");
    await wrapper.find(".tree-group").trigger("drop");
    expect(wrapper.emitted("move-workspace")).toHaveLength(1);
    wrapper.unmount();
  });

  it("dropping a row above another reorders the list and the order sticks", async () => {
    const wrapper = mountTree();

    // Dune dragged onto the TOP half of Blog → before Blog.
    await rowOf(wrapper, "Dune").trigger("dragstart");
    dragOverAt(slotOf(wrapper, "Blog").element, 5);
    await nextTick();
    expect(slotOf(wrapper, "Blog").classes()).toContain("tree-drop-before");
    await slotOf(wrapper, "Blog").trigger("drop");

    expect(wrapper.emitted("move-workspace")).toBeUndefined();
    expect(emittedOrder(wrapper)?.workspaces.root).toEqual(["ws-d", "ws-b"]);
    await feedBackOrder(wrapper);
    const rootNames = wrapper
      .findAll("ul.tree-root li.tree-slot")
      .map((node) => node.find(".truncate").text());
    expect(rootNames).toEqual(["Dune", "Blog"]);
    wrapper.unmount();
  });

  it("dropping a root row between a group's members joins the group at that spot", async () => {
    const wrapper = mountTree();

    // Blog onto the BOTTOM half of Acme → after Acme, before Cove.
    await rowOf(wrapper, "Blog").trigger("dragstart");
    dragOverAt(slotOf(wrapper, "Acme").element, 25);
    await nextTick();
    expect(slotOf(wrapper, "Acme").classes()).toContain("tree-drop-after");
    await slotOf(wrapper, "Acme").trigger("drop");

    expect(wrapper.emitted("move-workspace")).toEqual([["ws-b", "grp-1"]]);
    expect(emittedOrder(wrapper)?.workspaces["grp-1"]).toEqual(["ws-a", "ws-b", "ws-c"]);
    expect(emittedOrder(wrapper)?.workspaces.root ?? []).toEqual([]);
    wrapper.unmount();
  });

  it("a group drags above another group and the order sticks", async () => {
    const wrapper = mountTree();

    await headerOf(wrapper, "Side").trigger("dragstart");
    dragOverAt(headerOf(wrapper, "Clients").element, 5);
    await nextTick();
    expect(wrapper.find(".tree-group").classes()).toContain("tree-drop-before");
    await wrapper.find(".tree-group").trigger("drop");

    expect(emittedOrder(wrapper)?.groups).toEqual(["grp-2", "grp-1"]);
    await feedBackOrder(wrapper);
    const headerNames = wrapper.findAll(".tree-group-header").map((node) => node.find(".truncate").text());
    expect(headerNames).toEqual(["Side", "Clients"]);
    wrapper.unmount();
  });

  it("a stored order from the host sorts the lists and ignores ids that are gone", async () => {
    const wrapper = mountTree();
    await wrapper.setProps({
      treeOrder: { groups: ["grp-2", "gone", "grp-1"], workspaces: { root: ["ws-d", "ws-b"] } },
    });
    const headerNames = wrapper.findAll(".tree-group-header").map((node) => node.find(".truncate").text());
    expect(headerNames).toEqual(["Side", "Clients"]);
    const rootNames = wrapper
      .findAll("ul.tree-root li.tree-slot")
      .map((node) => node.find(".truncate").text());
    expect(rootNames).toEqual(["Dune", "Blog"]);
    wrapper.unmount();
  });
})
