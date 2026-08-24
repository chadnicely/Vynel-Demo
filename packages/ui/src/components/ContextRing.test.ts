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
  });

  // test: correct expectation — the tiers replaced the amber-at-70% + 85%
  // tick (2026-08-25): blue with room, yellow 75–85%, red past the swap.
  it("wears its tier: blue below 75%, yellow through 85%, red past it", () => {
    expect(mount(ContextRing, { props: { fraction: 0.5 } }).attributes("data-tier")).toBe("low");
    expect(mount(ContextRing, { props: { fraction: 0.74 } }).attributes("data-tier")).toBe("low");
    expect(mount(ContextRing, { props: { fraction: 0.75 } }).attributes("data-tier")).toBe("high");
    expect(mount(ContextRing, { props: { fraction: 0.85 } }).attributes("data-tier")).toBe("high");
    expect(mount(ContextRing, { props: { fraction: 0.86 } }).attributes("data-tier")).toBe("critical");
  });

  it("clamps past 100%", () => {
    const over = mount(ContextRing, { props: { fraction: 1.3 } });
    expect(over.attributes("aria-valuenow")).toBe("100");
    expect(Number(over.get(".ring-fill").attributes("stroke-dashoffset"))).toBe(
      0,
    );
    expect(over.attributes("data-tier")).toBe("critical");
  });

  it("carries the tooltip, and is the small 14px ring by default", () => {
    const wrapper = mount(ContextRing, {
      props: {
        fraction: 0.2,
        tooltip: "~40k of 200k · continues automatically near 85%",
      },
    });

    expect(wrapper.attributes("title")).toBe(
      "~40k of 200k · continues automatically near 85%",
    );
    expect(wrapper.get("svg").attributes("width")).toBe("14");
  });
});
