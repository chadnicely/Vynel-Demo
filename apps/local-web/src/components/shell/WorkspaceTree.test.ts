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

  it("creating lives on the groups and the bottom row, not the Global row", async () => {
    const wrapper = mountTree();

    // The Global row carries no create affordances any more.
    expect(wrapper.find('[aria-label="New folder"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="New workspace"]').exists()).toBe(false);

    // A group's own "+" pre-files the new workspace into it.
    await wrapper.find('[aria-label="New workspace in Clients"]').trigger("click");
    expect(wrapper.emitted("create-workspace")).toEqual([["grp-1"]]);

    // The bottom row creates at the root.
    await wrapper.find("button.tree-new-workspace").trigger("click");
    expect(wrapper.emitted("create-workspace")).toEqual([["grp-1"], [null]]);
    // No standalone new-group emit exists — groups are made from the dialog.
    expect(wrapper.emitted("create-group")).toBeUndefined();
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
