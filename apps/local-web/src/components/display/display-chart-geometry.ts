import {
  DISPLAY_CHART_MAX_SERIES,
  type ChartWidgetContent,
} from "@vynel/contracts/display/display-widget-content";

// The arithmetic behind `DisplayChartWidget` — content in, coordinates out.
// Pure and separate so the shapes a chart draws can be tested without a DOM
// (the `model-usage-series.ts` precedent), and so the component stays a
// template.
//
// Everything is expressed in ONE logical box and drawn through a `viewBox`:
// the chart then fits whatever width its slot gives it without measuring
// anything, which is what makes a widget survive being moved between the
// narrow columns and the stage.

export const CHART_VIEWBOX = { width: 320, height: 150 } as const;

/** Room at the bottom for the axis labels; the sides only need enough for a
 *  bar's stroke to not clip. */
const PLOT = { left: 6, right: 6, top: 10, bottom: 22 } as const;
const PLOT_WIDTH = CHART_VIEWBOX.width - PLOT.left - PLOT.right;
const PLOT_HEIGHT = CHART_VIEWBOX.height - PLOT.top - PLOT.bottom;

/** The four validated series colours. A fifth series has no accessible colour
 *  to draw with, which is why the contract caps at four. */
export const CHART_COLOR_VARS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4"] as const;

/** The ring: centred in the plot, thick enough to read at widget size. */
export const DONUT = { cx: CHART_VIEWBOX.width / 2, cy: 72, radius: 44, thickness: 18 } as const;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT.radius;

/** About six labels whatever the point count — more is unreadable at this size. */
const MAX_AXIS_TICKS = 6;

export interface ChartLegendEntry {
  readonly label: string;
  readonly colorVar: string;
}

export interface ChartAxisTick {
  readonly x: number;
  readonly label: string;
}

export interface ChartBar {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly colorVar: string;
}

export interface ChartLine {
  readonly key: string;
  readonly colorVar: string;
  readonly polyline: string;
  readonly dots: ReadonlyArray<{ x: number; y: number }>;
}

export interface ChartArc {
  readonly key: string;
  readonly label: string;
  readonly colorVar: string;
  readonly dashArray: string;
  readonly dashOffset: number;
}

export type DisplayChartModel =
  | { type: "bar"; title: string; legend: ChartLegendEntry[]; axis: ChartAxisTick[]; bars: ChartBar[] }
  | { type: "line"; title: string; legend: ChartLegendEntry[]; axis: ChartAxisTick[]; lines: ChartLine[] }
  | { type: "donut"; title: string; legend: ChartLegendEntry[]; arcs: ChartArc[] };

function colorVarAt(index: number): string {
  return CHART_COLOR_VARS[index % CHART_COLOR_VARS.length]!;
}

/** The drawn series — capped defensively, because a widget persisted under an
 *  older cap would otherwise ask for a colour that does not exist. */
function drawnSeries(content: ChartWidgetContent) {
  return content.series.slice(0, DISPLAY_CHART_MAX_SERIES);
}

/** The x axis is the LONGEST series' labels: series are index-aligned, so a
 *  shorter one simply stops early rather than shifting everything. */
function axisLabels(content: ChartWidgetContent): string[] {
  let labels: string[] = [];
  for (const series of drawnSeries(content)) {
    if (series.points.length > labels.length)
      labels = series.points.map((point) => point.label);
  }
  return labels;
}

/** Values map onto a domain that always includes zero, so a bar's baseline is
 *  the same line the reader assumes it is. */
function valueScale(content: ChartWidgetContent) {
  const values = drawnSeries(content).flatMap((series) =>
    series.points.map((point) => point.value),
  );
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  // A flat series (every value identical, or all zero) has no span to scale
  // against — 1 keeps the arithmetic finite and draws it on the baseline.
  const span = max - min || 1;
  const y = (value: number) => PLOT.top + ((max - value) / span) * PLOT_HEIGHT;
  return { y, baseline: y(0) };
}

function slotGeometry(slotCount: number) {
  const width = PLOT_WIDTH / Math.max(1, slotCount);
  return { width, center: (index: number) => PLOT.left + width * (index + 0.5) };
}

function axisTicks(labels: string[]): ChartAxisTick[] {
  const slot = slotGeometry(labels.length);
  const every = Math.max(1, Math.ceil(labels.length / MAX_AXIS_TICKS));
  return labels
    .map((label, index) => ({ x: slot.center(index), label, index }))
    .filter((tick) => tick.index % every === 0)
    .map(({ x, label }) => ({ x, label }));
}

function seriesLegend(content: ChartWidgetContent): ChartLegendEntry[] {
  return drawnSeries(content).map((series, index) => ({
    label: series.name,
    colorVar: colorVarAt(index),
  }));
}

function chartTitle(content: ChartWidgetContent, names: string[]): string {
  return `${content.type} chart of ${names.join(", ")}`;
}

function barsOf(content: ChartWidgetContent): ChartBar[] {
  const series = drawnSeries(content);
  const labels = axisLabels(content);
  const slot = slotGeometry(labels.length);
  const scale = valueScale(content);
  // Bars of one slot share 70% of it; the rest is the gap that groups them.
  const barWidth = (slot.width * 0.7) / series.length;
  const bars: ChartBar[] = [];
  series.forEach((entry, seriesIndex) => {
    entry.points.forEach((point, pointIndex) => {
      const y = scale.y(point.value);
      bars.push({
        key: `${seriesIndex}-${pointIndex}`,
        x: slot.center(pointIndex) - (slot.width * 0.7) / 2 + barWidth * seriesIndex,
        y: Math.min(y, scale.baseline),
        width: Math.max(1, barWidth - 1),
        height: Math.max(1, Math.abs(scale.baseline - y)),
        colorVar: colorVarAt(seriesIndex),
      });
    });
  });
  return bars;
}

function linesOf(content: ChartWidgetContent): ChartLine[] {
  const labels = axisLabels(content);
  const slot = slotGeometry(labels.length);
  const scale = valueScale(content);
  return drawnSeries(content).map((entry, seriesIndex) => {
    const dots = entry.points.map((point, pointIndex) => ({
      x: slot.center(pointIndex),
      y: scale.y(point.value),
    }));
    return {
      key: `${seriesIndex}-${entry.name}`,
      colorVar: colorVarAt(seriesIndex),
      polyline: dots.map((dot) => `${dot.x},${dot.y}`).join(" "),
      dots,
    };
  });
}

/** A donut shows parts of ONE whole, so its slices are the FIRST series'
 *  points — not the series, which would draw a single featureless ring for
 *  the one-series content the model actually sends. Colours cycle past four
 *  slices: position, not hue, is what a slice is read by. */
function arcsOf(content: ChartWidgetContent): ChartArc[] {
  const points = content.series[0]?.points ?? [];
  // Negatives have no meaning in a share of a whole, and a zero total would
  // put NaN in every dash — either way there is nothing to draw.
  const shares = points.map((point) => Math.max(0, point.value));
  const total = shares.reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  let consumed = 0;
  return points.map((point, index) => {
    const length = (shares[index]! / total) * DONUT_CIRCUMFERENCE;
    const arc: ChartArc = {
      key: `${index}-${point.label}`,
      label: point.label,
      colorVar: colorVarAt(index),
      dashArray: `${length} ${DONUT_CIRCUMFERENCE - length}`,
      dashOffset: -consumed,
    };
    consumed += length;
    return arc;
  });
}

export function buildDisplayChart(content: ChartWidgetContent): DisplayChartModel {
  if (content.type === "donut") {
    const arcs = arcsOf(content);
    return {
      type: "donut",
      title: chartTitle(
        content,
        arcs.map((arc) => arc.label),
      ),
      legend: arcs.map((arc) => ({ label: arc.label, colorVar: arc.colorVar })),
      arcs,
    };
  }
  const legend = seriesLegend(content);
  const axis = axisTicks(axisLabels(content));
  const title = chartTitle(
    content,
    legend.map((entry) => entry.label),
  );
  return content.type === "bar"
    ? { type: "bar", title, legend, axis, bars: barsOf(content) }
    : { type: "line", title, legend, axis, lines: linesOf(content) };
}
