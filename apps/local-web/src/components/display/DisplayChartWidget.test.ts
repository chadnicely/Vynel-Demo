// The drawing itself: the right number of shapes, an accessible name, and no
// dependency on a chart library.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChartWidgetContent } from "@vynel/contracts/display/display-widget-content";
import DisplayChartWidget from "./DisplayChartWidget.vue";

function mountChart(
  type: ChartWidgetContent["type"],
  series: ChartWidgetContent["series"],
) {
  return mount(DisplayChartWidget, {
    props: { content: { kind: "chart", type, series } },
  });
}

function points(...values: number[]) {
  return values.map((value, index) => ({ label: `d${index}`, value }));
}

describe("DisplayChartWidget", () => {
  it("draws a rect per point per series and labels the axis", () => {
    const wrapper = mountChart("bar", [
      { name: "Runs", points: points(3, 6, 9) },
      { name: "Failures", points: points(1, 0, 2) },
    ]);

    expect(wrapper.findAll("rect")).toHaveLength(6);
    expect(wrapper.findAll("text").map((label) => label.text())).toEqual([
      "d0",
      "d1",
      "d2",
    ]);
    expect(wrapper.find("svg title").text()).toBe("bar chart of Runs, Failures");
    expect(wrapper.find("svg").attributes("role")).toBe("img");
  });

  it("draws a polyline per series and a dot per point", () => {
    const wrapper = mountChart("line", [{ name: "Latency", points: points(10, 20, 15) }]);

    expect(wrapper.findAll("polyline")).toHaveLength(1);
    expect(wrapper.findAll("circle")).toHaveLength(3);
    expect(wrapper.find("polyline").attributes("points")).not.toContain("NaN");
  });

  it("draws one arc per slice over the ring", () => {
    const wrapper = mountChart("donut", [
      {
        name: "Share",
        points: [
          { label: "Green", value: 3 },
          { label: "Red", value: 1 },
        ],
      },
    ]);

    // The background ring plus one circle per slice.
    expect(wrapper.findAll("circle.arc")).toHaveLength(2);
    expect(wrapper.findAll("circle")).toHaveLength(3);
    expect(wrapper.find("svg title").text()).toBe("donut chart of Green, Red");
  });

  it("scales through a viewBox rather than a fixed size", () => {
    const wrapper = mountChart("bar", [{ name: "Runs", points: points(1) }]);
    const svg = wrapper.find("svg");

    expect(svg.attributes("viewBox")).toBe("0 0 320 150");
    expect(svg.attributes("width")).toBeUndefined();
  });

  it("shows a legend only once there is more than one entry", () => {
    const single = mountChart("bar", [{ name: "Runs", points: points(1) }]);
    expect(single.find('[data-testid="display-chart-legend"]').exists()).toBe(false);

    const paired = mountChart("bar", [
      { name: "Runs", points: points(1) },
      { name: "Failures", points: points(2) },
    ]);
    expect(
      paired.findAll('[data-testid="display-chart-legend"] li').map((item) => item.text()),
    ).toEqual(["Runs", "Failures"]);
  });
});
