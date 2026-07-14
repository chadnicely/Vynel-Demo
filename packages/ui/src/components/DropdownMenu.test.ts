import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DropdownMenu from "./DropdownMenu.vue";
import type { MenuItemModel } from "./menu-shared.js";

const items: MenuItemModel[] = [
  { id: "new", label: "New chat", shortcut: "⌘N" },
  { id: "sep", kind: "separator" },
  { id: "delete", label: "Delete", danger: true },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("DropdownMenu", () => {
  it("renders the trigger slot", () => {
    const wrapper = mount(DropdownMenu, {
      props: { items },
      slots: { trigger: '<button type="button">Menu</button>' },
    });
    expect(wrapper.text()).toContain("Menu");
  });

  it("renders items when open and emits select on choice", async () => {
    const wrapper = mount(DropdownMenu, {
      props: { items, open: true },
      slots: { trigger: '<button type="button">Menu</button>' },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    const menuItems = document.body.querySelectorAll('[role="menuitem"]');
    expect(menuItems.length).toBe(2); // "New chat" + "Delete" (separator excluded)

    (menuItems[0] as HTMLElement).click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("select")).toEqual([["new"]]);
  });
});
