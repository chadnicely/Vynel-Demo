import { describe, it, expect } from "vitest";
import {
  buildUsageChartModel,
  formatTokenCount,
  modelDisplayLabel,
  type DailyUsageRow,
} from "./model-usage-series.js";

function usageRow(overrides: Partial<DailyUsageRow>): DailyUsageRow {
  return {
    day: "2026-06-10",
    model: "claude-opus-4-8",
    providerId: "claude",
    inputTokens: 100,
    outputTokens: 50,
    assistantMessageCount: 1,
    ...overrides,
  };
}

describe("modelDisplayLabel", () => {
  it("uses the catalog label when the id is known", () => {
    expect(modelDisplayLabel("claude-opus-4-8")).toBe("Opus 4.8");
  });

  it("prettifies unknown ids into family + dotted version", () => {
    expect(modelDisplayLabel("claude-nova-7-2")).toBe("Nova 7.2");
  });

  it("labels null as unknown", () => {
    expect(modelDisplayLabel(null)).toBe("Unknown model");
  });
});

describe("formatTokenCount", () => {
  it("keeps small counts plain and compacts thousands/millions", () => {
    expect(formatTokenCount(950)).toBe("950");
    expect(formatTokenCount(12_400)).toBe("12.4k");
    expect(formatTokenCount(158_700)).toBe("159k");
    expect(formatTokenCount(1_240_000)).toBe("1.2M");
  });
});

describe("buildUsageChartModel", () => {
  const today = new Date(2026, 5, 10);

  it("builds a continuous day axis ending today, with empty slots for quiet days", () => {
    const chart = buildUsageChartModel([usageRow({})], 3, today);
    expect(chart.days.map((day) => day.day)).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
    ]);
    expect(chart.days[0]!.segments).toEqual([]);
    expect(chart.days[2]!.totalTokens).toBe(150);
  });

  it("assigns series colors by sorted model id, stable across ranges", () => {
    const rows = [
      usageRow({ model: "claude-sonnet-5" }),
      usageRow({ model: "claude-opus-4-8" }),
    ];
    const wide = buildUsageChartModel(rows, 30, today);
    const narrow = buildUsageChartModel(rows, 7, today);
    expect(wide.series.map((entry) => [entry.key, entry.colorVar])).toEqual([
      ["claude-opus-4-8", "--chart-1"],
      ["claude-sonnet-5", "--chart-2"],
    ]);
    expect(narrow.series).toEqual(wide.series);
  });

  it("folds overflow models into a gray Other series and keeps the heavy hitters colored", () => {
    const rows = [
      usageRow({ model: "claude-a", inputTokens: 900 }),
      usageRow({ model: "claude-b", inputTokens: 800 }),
      usageRow({ model: "claude-c", inputTokens: 700 }),
      usageRow({ model: "claude-d", inputTokens: 10 }),
      usageRow({ model: "claude-e", inputTokens: 5 }),
    ];
    const chart = buildUsageChartModel(rows, 1, today);
    expect(chart.series).toHaveLength(4);
    const other = chart.series.at(-1)!;
    expect(other.label).toBe("Other");
    expect(other.colorVar).toBe("--ink-3");
    // d + e fold together: 10+5 input plus their two 50-output rows.
    const otherSegment = chart.days[0]!.segments.find(
      (segment) => segment.key === other.key,
    );
    expect(otherSegment?.totalTokens).toBe(115);
  });

  it("sums totals across the whole window", () => {
    const chart = buildUsageChartModel(
      [
        usageRow({ day: "2026-06-09", inputTokens: 100, outputTokens: 0 }),
        usageRow({ day: "2026-06-10", inputTokens: 200, outputTokens: 25 }),
      ],
      7,
      today,
    );
    expect(chart.grandTotal).toBe(325);
    expect(chart.maxDayTotal).toBe(225);
  });
});
