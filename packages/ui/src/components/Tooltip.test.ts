import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import Tooltip from "./Tooltip.vue";

describe("Tooltip", () => {
  it("renders its trigger slot", () => {
    const wrapper = mount(Tooltip, {
      props: { label: "Toggle theme" },
      slots: { default: '<button type="button">Theme</button>' },
    });
    expect(wrapper.find("button").exists()).toBe(true);
    expect(wrapper.text()).toContain("Theme");
  });

  it("passes the trigger straight through when disabled", () => {
    const wrapper = mount(Tooltip, {
      props: { label: "Toggle theme", disabled: true },
      slots: { default: '<button type="button">Theme</button>' },
    });
    expect(wrapper.find("button").exists()).toBe(true);
  });
});
