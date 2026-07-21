import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ContextRing from "./ContextRing.vue";

describe("ContextRing", () => {
  it("draws the arc proportionally and reports the aria value", () => {
    const wrapper = mount(ContextRing, { props: { fraction: 0.5 } });

    const fill = wrapper.get(".ring-fill");
    const dash = Number(fill.attributes("stroke-dasharray"));
    const offset = Number(fill.attributes("stroke-dashoffset"));
    expect(offset).toBeCloseTo(dash * 0.5, 5);
    expect(wrapper.attributes("aria-valuenow")).toBe("50");
    expect(wrapper.classes()).not.toContain("is-warn");
  });

  it("turns amber at 70% and clamps past 100%", () => {
    const warn = mount(ContextRing, { props: { fraction: 0.71 } });
    expect(warn.classes()).toContain("is-warn");

    const over = mount(ContextRing, { props: { fraction: 1.3 } });
    expect(over.attributes("aria-valuenow")).toBe("100");
    expect(Number(over.get(".ring-fill").attributes("stroke-dashoffset"))).toBe(
      0,
    );
  });

  it("marks the 85% auto-continue tick and carries the tooltip", () => {
    const wrapper = mount(ContextRing, {
      props: {
        fraction: 0.2,
        tooltip: "~40k of 200k · continues automatically near 85%",
      },
    });

    expect(wrapper.find(".swap-mark").exists()).toBe(true);
    expect(wrapper.attributes("title")).toBe(
      "~40k of 200k · continues automatically near 85%",
    );
  });
});
