import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import WorkspaceColorPicker from "./WorkspaceColorPicker.vue";
import { WORKSPACE_ACCENT_SLOTS } from "../lib/workspace-color.js";

describe("WorkspaceColorPicker", () => {
  it("renders Auto, the palette, and a custom swatch; palette clicks emit the slot", async () => {
    const wrapper = mount(WorkspaceColorPicker, {
      props: { selectedSlot: null, customColor: null },
    });

    expect(wrapper.findAll("button")).toHaveLength(1 + WORKSPACE_ACCENT_SLOTS);
    expect(wrapper.find('input[type="color"][aria-label="Custom color"]').exists()).toBe(true);
    // Nothing chosen → Auto is the pressed one.
    expect(wrapper.find('[aria-label="Automatic color"]').attributes("aria-pressed")).toBe("true");

    await wrapper.find('[aria-label="Teal"]').trigger("click");
    expect(wrapper.emitted("pick")?.[0]).toEqual([1]);
    await wrapper.find('[aria-label="Automatic color"]').trigger("click");
    expect(wrapper.emitted("pick")?.[1]).toEqual([null]);
  });

  it("a chosen custom colour un-presses Auto and paints the custom swatch", () => {
    const wrapper = mount(WorkspaceColorPicker, {
      props: { selectedSlot: null, customColor: "#1e90ff" },
    });

    expect(wrapper.find('[aria-label="Automatic color"]').attributes("aria-pressed")).toBe("false");
    const swatch = wrapper.find("label.custom-swatch");
    expect(swatch.attributes("style")).toContain("#1e90ff");
    expect(swatch.classes()).toContain("ring-2");
    expect(wrapper.find('input[type="color"]').element).toHaveProperty("value", "#1e90ff");
  });

  it("typing into the colour input emits pickCustom with the hex", async () => {
    const wrapper = mount(WorkspaceColorPicker, {
      props: { selectedSlot: 2, customColor: null },
    });

    const input = wrapper.find<HTMLInputElement>('input[type="color"]');
    await input.setValue("#abcdef");
    expect(wrapper.emitted("pickCustom")?.[0]).toEqual(["#abcdef"]);
  });
});
