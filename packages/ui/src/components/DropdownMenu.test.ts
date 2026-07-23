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

  it("renders the footer slot after the items; footer clicks don't close or select", async () => {
    const wrapper = mount(DropdownMenu, {
      props: { items, open: true },
      slots: {
        trigger: '<button type="button">Menu</button>',
        footer: '<div data-testid="footer-row"><button type="button">Swatch</button></div>',
      },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    const footer = document.body.querySelector('[data-testid="footer-row"]');
    expect(footer).not.toBeNull();

    // Order: the footer follows the last menu item.
    const menuItems = document.body.querySelectorAll('[role="menuitem"]');
    const lastItem = menuItems[menuItems.length - 1]!;
    expect(
      lastItem.compareDocumentPosition(footer!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // A free-form footer control is not a menu item: clicking it emits no
    // `select` and the menu stays open (live-preview contract).
    (footer!.querySelector("button") as HTMLElement).click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  });
});
