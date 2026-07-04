import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PresenceDot from "./PresenceDot.vue";

describe("PresenceDot", () => {
  it("defaults to the idle state with an accessible label", () => {
    const wrapper = mount(PresenceDot);

    expect(wrapper.classes()).toContain("is-idle");
    expect(wrapper.attributes("aria-label")).toBe("assistant idle");
  });

  it("reflects the presence state as a class and in the label", () => {
    const wrapper = mount(PresenceDot, {
      props: { state: "live", label: "a task is running" },
    });

    expect(wrapper.classes()).toContain("is-live");
    expect(wrapper.attributes("aria-label")).toBe("a task is running");
  });
});
