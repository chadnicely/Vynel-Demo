import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DemoTrendLine from "./DemoTrendLine.vue";

describe("DemoTrendLine", () => {
  it("shows the sparkline AND the words beside it", () => {
    const wrapper = mount(DemoTrendLine, {
      props: { label: "Sales", value: "$1,508" },
    });
    expect(wrapper.find("path").attributes("d")).toBeTruthy();
    expect(wrapper.text()).toMatch(/(up|down) \d+% from yesterday/);
  });

  // The room hides every element named `.caption` on purpose, with an unscoped
  // rule that reached into this component and swallowed the words.
  it("keeps its words off the class the room hides", () => {
    const wrapper = mount(DemoTrendLine, {
      props: { label: "Sales", value: "$1,508" },
    });
    expect(wrapper.find(".caption").exists()).toBe(false);
    expect(wrapper.find(".trend-caption").exists()).toBe(true);
  });

  it("never points a hero figure downward", () => {
    for (const value of ["$1,508", "530", "$92", "47"]) {
      const wrapper = mount(DemoTrendLine, { props: { label: "Sales", value } });
      expect(wrapper.classes()).toContain("up");
    }
  });
});
