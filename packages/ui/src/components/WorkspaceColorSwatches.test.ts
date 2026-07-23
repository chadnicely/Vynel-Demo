import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import DropdownMenu from "./DropdownMenu.vue";
import WorkspaceColorSwatches from "./WorkspaceColorSwatches.vue";
import { WORKSPACE_ACCENT_SLOTS } from "../lib/workspace-color.js";

// The swatches only exist inside a menu (reka items need the menu context),
// so every test mounts them the way consumers do: in the footer slot.
function mountInMenu(
  selectedSlot: number | null,
  onPick: (slot: number | null) => void = () => {},
) {
  return mount(DropdownMenu, {
    props: { items: [{ id: "a", label: "Item A" }], open: true },
    slots: {
      trigger: '<button type="button">Menu</button>',
      footer: () =>
        h(WorkspaceColorSwatches, { selectedSlot, label: "Tab color", onPick }),
    },
    attachTo: document.body,
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WorkspaceColorSwatches", () => {
  it("renders Auto + the palette as REAL menu items (keyboard-rovable)", async () => {
    const wrapper = mountInMenu(null);
    await wrapper.vm.$nextTick();

    const menuItems = document.body.querySelectorAll('[role="menuitem"]');
    // "Item A" + Auto + one per palette slot — all registered with the menu.
    expect(menuItems.length).toBe(1 + 1 + WORKSPACE_ACCENT_SLOTS);
    expect(
      document.body.querySelector('[aria-label="Automatic color"]'),
    ).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Teal"]')).not.toBeNull();
  });

  it("picking a swatch emits the slot and KEEPS the menu open", async () => {
    const onPick = vi.fn();
    const wrapper = mountInMenu(null, onPick);
    await wrapper.vm.$nextTick();

    (document.body.querySelector('[aria-label="Teal"]') as HTMLElement).click();
    await wrapper.vm.$nextTick();

    expect(onPick).toHaveBeenCalledWith(1);
    // Prevented select: no menu `select` event, content still mounted.
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("Auto emits null and rings only the selected swatch", async () => {
    const onPick = vi.fn();
    const wrapper = mountInMenu(2, onPick);
    await wrapper.vm.$nextTick();

    const auto = document.body.querySelector(
      '[aria-label="Automatic color"]',
    ) as HTMLElement;
    auto.click();
    expect(onPick).toHaveBeenCalledWith(null);

    expect(
      document.body
        .querySelector('[aria-label="Blue"]')!
        .className.includes("ring-2"),
    ).toBe(true);
    expect(
      document.body
        .querySelector('[aria-label="Indigo"]')!
        .className.includes("ring-2"),
    ).toBe(false);
  });
});
