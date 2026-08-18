// Tests for the workspace tree's folder interactions — the inline rename
// (focus via the v-for ARRAY ref — the exact break a scalar ref caused) and
// the drag-drop membership emits. Mounted directly: the reka-ui context
// menu is exercised in @vynel/ui's own tests; the double-click path drives
// the same startRename.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import WorkspaceTree from "./WorkspaceTree.vue";

function mountTree() {
  return mount(WorkspaceTree, {
    props: {
      workspaces: [
        { id: "ws-a", name: "Acme", groupId: "grp-1" },
        { id: "ws-b", name: "Blog", groupId: null },
      ],
      groups: [{ id: "grp-1", name: "Clients" }],
      activeWorkspaceId: null,
      // Alive views (open tasks) — parked rows would fold into NOT RUNNING
      // and out of the folder/root zones these tests drive.
      statusByWorkspaceId: {
        "ws-a": { status: "running" as const, note: null, tasksDone: 1, tasksTotal: 3 },
        "ws-b": { status: "not_running" as const, note: null, tasksDone: 0, tasksTotal: 2 },
      },
      globalStatus: "not_running" as const,
      accountName: "Sam",
    },
    attachTo: document.body,
  });
}

describe("WorkspaceTree", () => {
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

  it("dropping a dragged row on a folder emits the move; same folder is a no-op", async () => {
    const wrapper = mountTree();

    // Drag the root row (Blog) onto the Clients folder.
    const blogRow = wrapper
      .findAll('[draggable="true"]')
      .find((node) => node.text().includes("Blog"));
    await blogRow!.trigger("dragstart");
    const folder = wrapper
      .findAll("div")
      .find((node) => node.classes().includes("border-dashed") && node.text().includes("Clients"));
    await folder!.trigger("dragover");
    await folder!.trigger("drop");
    expect(wrapper.emitted("move-workspace")).toEqual([["ws-b", "grp-1"]]);

    // Dragging the member (Acme) onto its own folder must not emit.
    const acmeRow = wrapper
      .findAll('[draggable="true"]')
      .find((node) => node.text().includes("Acme"));
    await acmeRow!.trigger("dragstart");
    await folder!.trigger("dragover");
    await folder!.trigger("drop");
    expect(wrapper.emitted("move-workspace")).toHaveLength(1);
    wrapper.unmount();
  });
})
