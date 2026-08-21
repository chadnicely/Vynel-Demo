// The arithmetic a chart is drawn from — the finite-number guards especially:
// a NaN in a `stroke-dasharray` or a `y` silently blanks the whole drawing.

import { describe, expect, it } from "vitest";
import type { ChartWidgetContent } from "@vynel/contracts/display/display-widget-content";
import {
  CHART_COLOR_VARS,
  buildDisplayChart,
  type DisplayChartModel,
} from "./display-chart-geometry.js";

function chart(
  type: ChartWidgetContent["type"],
  series: ChartWidgetContent["series"],
): DisplayChartModel {
  return buildDisplayChart({ kind: "chart", type, series });
}

function points(...values: number[]) {
  return values.map((value, index) => ({ label: `d${index}`, value }));
}

const isFinitePair = (values: number[]) => values.every(Number.isFinite);

describe("buildDisplayChart", () => {
  it("draws one bar per point per series, in series colours", () => {
    const model = chart("bar", [
      { name: "Runs", points: points(3, 6, 9) },
      { name: "Failures", points: points(1, 0, 2) },
    ]);

    if (model.type !== "bar") throw new Error("expected a bar chart");
    expect(model.bars).toHaveLength(6);
    expect(model.bars.map((bar) => bar.colorVar)).toEqual([
      CHART_COLOR_VARS[0],
      CHART_COLOR_VARS[0],
      CHART_COLOR_VARS[0],
      CHART_COLOR_VARS[1],
      CHART_COLOR_VARS[1],
      CHART_COLOR_VARS[1],
    ]);
    expect(
      isFinitePair(model.bars.flatMap((bar) => [bar.x, bar.y, bar.width, bar.height])),
    ).toBe(true);
    // A taller value draws a taller bar — the one property a reader relies on.
    expect(model.bars[2]!.height).toBeGreaterThan(model.bars[0]!.height);
  });

  it("keeps flat and all-zero series finite", () => {
    const flat = chart("bar", [{ name: "Runs", points: points(0, 0, 0) }]);

    if (flat.type !== "bar") throw new Error("expected a bar chart");
    expect(isFinitePair(flat.bars.map((bar) => bar.height))).toBe(true);
  });

  it("puts a negative value below the zero baseline", () => {
    const model = chart("bar", [{ name: "Net", points: points(4, -4) }]);

    if (model.type !== "bar") throw new Error("expected a bar chart");
    expect(model.bars[1]!.y).toBeGreaterThan(model.bars[0]!.y);
  });

  it("draws one dot per point and one polyline per series", () => {
    const model = chart("line", [
      { name: "Latency", points: points(10, 20, 15, 30) },
      { name: "Errors", points: points(1, 2, 1, 0) },
    ]);

    if (model.type !== "line") throw new Error("expected a line chart");
    expect(model.lines).toHaveLength(2);
    expect(model.lines[0]!.dots).toHaveLength(4);
    expect(model.lines[0]!.polyline.split(" ")).toHaveLength(4);
    expect(model.lines[0]!.polyline).not.toContain("NaN");
  });

  it("slices a donut from the first series' points, one arc each", () => {
    const model = chart("donut", [
      { name: "Share", points: [
        { label: "Green", value: 3 },
        { label: "Red", value: 1 },
      ] },
    ]);

    if (model.type !== "donut") throw new Error("expected a donut chart");
    expect(model.arcs.map((arc) => arc.label)).toEqual(["Green", "Red"]);
    // Three quarters then one quarter, laid end to end.
    const [green, red] = model.arcs;
    expect(Number(green!.dashArray.split(" ")[0])).toBeCloseTo(
      Number(red!.dashArray.split(" ")[0]) * 3,
    );
    expect(green!.dashOffset).toBeCloseTo(0);
    expect(red!.dashOffset).toBeLessThan(0);
  });

  it("cycles the four colours past the fourth slice", () => {
    const model = chart("donut", [
      { name: "Share", points: points(1, 1, 1, 1, 1) },
    ]);

    if (model.type !== "donut") throw new Error("expected a donut chart");
    expect(model.arcs).toHaveLength(5);
    expect(model.arcs[4]!.colorVar).toBe(CHART_COLOR_VARS[0]);
  });

  it("draws no arc when nothing has a share", () => {
    const model = chart("donut", [{ name: "Share", points: points(0, 0) }]);

    if (model.type !== "donut") throw new Error("expected a donut chart");
    expect(model.arcs).toEqual([]);
  });

  it("thins the axis to about six labels", () => {
    const model = chart("line", [
      { name: "Latency", points: points(...Array.from({ length: 30 }, (_, i) => i)) },
    ]);

    if (model.type !== "line") throw new Error("expected a line chart");
    expect(model.axis.length).toBeLessThanOrEqual(6);
    expect(model.axis[0]!.label).toBe("d0");
  });

  it("names the chart and its series in the title", () => {
    const model = chart("bar", [
      { name: "Runs", points: points(1) },
      { name: "Failures", points: points(2) },
    ]);

    expect(model.title).toBe("bar chart of Runs, Failures");
  });
});
