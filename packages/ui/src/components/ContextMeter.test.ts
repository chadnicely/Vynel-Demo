import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ContextMeter from "./ContextMeter.vue";

describe("ContextMeter", () => {
  it("renders the occupancy as fill width, readout, and aria value", () => {
    const wrapper = mount(ContextMeter, { props: { fraction: 0.42 } });

    expect(wrapper.get(".fill").attributes("style")).toContain("width: 42%");
    expect(wrapper.get(".readout").text()).toBe("42%");
    expect(wrapper.attributes("aria-valuenow")).toBe("42");
    expect(wrapper.classes()).not.toContain("is-warn");
  });

  it("turns amber at 70% and up", () => {
    expect(
      mount(ContextMeter, { props: { fraction: 0.69 } }).classes(),
    ).not.toContain("is-warn");
    expect(
      mount(ContextMeter, { props: { fraction: 0.7 } }).classes(),
    ).toContain("is-warn");
  });

  it("clamps out-of-range fractions", () => {
    expect(
      mount(ContextMeter, { props: { fraction: 1.4 } }).attributes(
        "aria-valuenow",
      ),
    ).toBe("100");
    expect(
      mount(ContextMeter, { props: { fraction: -0.2 } }).attributes(
        "aria-valuenow",
      ),
    ).toBe("0");
  });

  it("marks the 85% auto-continue line and carries the tooltip", () => {
    const wrapper = mount(ContextMeter, {
      props: {
        fraction: 0.83,
        tooltip: "~166k of 200k · continues automatically near 85%",
      },
    });

    expect(wrapper.find(".swap-mark").exists()).toBe(true);
    expect(wrapper.attributes("title")).toBe(
      "~166k of 200k · continues automatically near 85%",
    );
  });
});
