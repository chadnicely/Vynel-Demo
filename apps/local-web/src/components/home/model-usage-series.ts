// Pure transforms behind UsageStatsCard: wire rows → a renderable chart model.
// Series colors follow the MODEL (stable sorted assignment within the kept
// set), never its rank. At most four colored series; everything beyond folds
// into an ink-gray "Other" — a range switch that changes which models are
// kept may reassign, but within one view colors never chase rank.

import { CHAT_MODELS } from "@vynel/contracts/chat/chat-models";

export type DailyUsageRow = {
  day: string;
  model: string | null;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  assistantMessageCount: number;
};

export type UsageSeries = {
  key: string;
  label: string;
  colorVar: string;
};

export type UsageDaySegment = UsageSeries & {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type UsageDay = {
  day: string;
  label: string;
  totalTokens: number;
  segments: UsageDaySegment[];
};

export type UsageChartModel = {
  days: UsageDay[];
  series: UsageSeries[];
  maxDayTotal: number;
  grandTotal: number;
};

const SERIES_COLOR_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
] as const;
const OTHER_COLOR_VAR = "--ink-3";
const OTHER_KEY = "__other__";
const NULL_MODEL_KEY = "__unknown__";

export function modelDisplayLabel(model: string | null): string {
  if (model === null) return "Unknown model";
  const catalogLabel = CHAT_MODELS.find((option) => option.id === model)?.label;
  if (catalogLabel !== undefined) return catalogLabel;
  // Ids the static catalog doesn't know (the roster is discovered at
  // runtime): "claude-opus-4-8" → "Opus 4.8".
  const words: string[] = [];
  const versionParts: string[] = [];
  for (const part of model.replace(/^claude-/, "").split("-")) {
    if (/^\d/.test(part)) versionParts.push(part);
    else words.push(part.charAt(0).toUpperCase() + part.slice(1));
  }
  return [words.join(" "), versionParts.join(".")].filter(Boolean).join(" ");
}

export function formatTokenCount(count: number): string {
  if (count < 1_000) return String(count);
  const scaled = count < 1_000_000 ? count / 1_000 : count / 1_000_000;
  const suffix = count < 1_000_000 ? "k" : "M";
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${rounded}${suffix}`;
}

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

function dayAxisLabel(day: string): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  return new Date(year!, month! - 1, dayOfMonth!).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function seriesKeyFor(model: string | null): string {
  return model ?? NULL_MODEL_KEY;
}

export function buildUsageChartModel(
  rows: DailyUsageRow[],
  windowDays: number,
  today: Date,
): UsageChartModel {
  // Which models get their own color: stable sorted order; when there are
  // more models than colors, the highest-volume ones keep their color and
  // the tail folds into "Other".
  const totalsByModel = new Map<string, number>();
  for (const row of rows) {
    const key = seriesKeyFor(row.model);
    totalsByModel.set(
      key,
      (totalsByModel.get(key) ?? 0) + row.inputTokens + row.outputTokens,
    );
  }
  let coloredKeys = [...totalsByModel.keys()].sort();
  let hasOther = false;
  if (coloredKeys.length > SERIES_COLOR_VARS.length) {
    const keptByVolume = new Set(
      [...totalsByModel.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, SERIES_COLOR_VARS.length - 1)
        .map(([key]) => key),
    );
    coloredKeys = coloredKeys.filter((key) => keptByVolume.has(key));
    hasOther = true;
  }

  const series: UsageSeries[] = coloredKeys.map((key, index) => ({
    key,
    label: modelDisplayLabel(key === NULL_MODEL_KEY ? null : key),
    colorVar: SERIES_COLOR_VARS[index]!,
  }));
  if (hasOther) {
    series.push({ key: OTHER_KEY, label: "Other", colorVar: OTHER_COLOR_VAR });
  }
  const seriesByKey = new Map(series.map((entry) => [entry.key, entry]));

  const rowsByDay = new Map<string, DailyUsageRow[]>();
  for (const row of rows) {
    const dayRows = rowsByDay.get(row.day) ?? [];
    dayRows.push(row);
    rowsByDay.set(row.day, dayRows);
  }

  // A continuous axis — quiet days render as empty slots, not gaps.
  const days: UsageDay[] = [];
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const day = localDayKey(
      new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset),
    );
    const segmentsByKey = new Map<string, UsageDaySegment>();
    for (const row of rowsByDay.get(day) ?? []) {
      const rowSeries =
        seriesByKey.get(seriesKeyFor(row.model)) ?? seriesByKey.get(OTHER_KEY)!;
      let segment = segmentsByKey.get(rowSeries.key);
      if (segment === undefined) {
        segment = { ...rowSeries, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        segmentsByKey.set(rowSeries.key, segment);
      }
      segment.inputTokens += row.inputTokens;
      segment.outputTokens += row.outputTokens;
      segment.totalTokens += row.inputTokens + row.outputTokens;
    }
    // Segments stack in series order so every bar reads the same way.
    const segments = series
      .map((entry) => segmentsByKey.get(entry.key))
      .filter((segment): segment is UsageDaySegment => segment !== undefined);
    days.push({
      day,
      label: dayAxisLabel(day),
      totalTokens: segments.reduce((sum, segment) => sum + segment.totalTokens, 0),
      segments,
    });
  }

  const maxDayTotal = Math.max(0, ...days.map((day) => day.totalTokens));
  const grandTotal = days.reduce((sum, day) => sum + day.totalTokens, 0);
  return { days, series, maxDayTotal, grandTotal };
}
