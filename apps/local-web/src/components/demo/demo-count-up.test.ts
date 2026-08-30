import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DemoCountUp from "./DemoCountUp.vue";

// jsdom has no rAF timing worth driving, so these pin the two things that
// matter off camera: the figure is never WRONG, and it never renders a blank.
describe("DemoCountUp", () => {
  it("carries the written figure as its accessible name from the first frame", () => {
    const wrapper = mount(DemoCountUp, { props: { value: "$1,508" } });
    expect(wrapper.attributes("aria-label")).toBe("$1,508");
  });

  it("lands on the written figure exactly, currency and grouping intact", async () => {
    const wrapper = mount(DemoCountUp, { props: { value: "$1,508" } });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(wrapper.text()).toBe("$1,508");
  });

  it("shows a figure it cannot roll rather than a zero", () => {
    const wrapper = mount(DemoCountUp, { props: { value: "all clear" } });
    expect(wrapper.text()).toBe("all clear");
  });

  it("rolls again when the figure changes", async () => {
    const wrapper = mount(DemoCountUp, { props: { value: "29%" } });
    await wrapper.setProps({ value: "530" });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(wrapper.text()).toBe("530");
  });
});
