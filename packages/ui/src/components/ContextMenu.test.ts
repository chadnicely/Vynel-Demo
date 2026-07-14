import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ContextMenu from "./ContextMenu.vue";
import type { MenuItemModel } from "./menu-shared.js";

const items: MenuItemModel[] = [
  { id: "copy", label: "Copy" },
  { id: "sep", kind: "separator" },
  { id: "delete", label: "Delete", danger: true },
];

describe("ContextMenu", () => {
  it("renders the target in its default slot", () => {
    const wrapper = mount(ContextMenu, {
      props: { items },
      slots: { default: '<div class="target">Right-click me</div>' },
    });
    expect(wrapper.find(".target").exists()).toBe(true);
    expect(wrapper.text()).toContain("Right-click me");
  });
});
