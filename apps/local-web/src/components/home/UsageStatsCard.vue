<script setup lang="ts">
import { computed, ref } from "vue";
import { BarChart3 } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useUsageStats } from "../../composables/dashboard/use-usage-stats.js";
import {
  buildUsageChartModel,
  formatTokenCount,
} from "./model-usage-series.js";

// Token usage per model per day. One card serves both dashboards: no
// workspaceId = everything (global Home), a workspaceId = that workspace.
const props = defineProps<{ workspaceId?: string | null }>();

const RANGE_OPTIONS = [
  { days: 7, label: "Week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "Month" },
] as const;
const rangeDays = ref<number>(14);

const usageQuery = useUsageStats(
  () => rangeDays.value,
  () => props.workspaceId ?? null,
);

const chart = computed(() =>
  buildUsageChartModel(
    usageQuery.data.value?.rows ?? [],
    rangeDays.value,
    new Date(),
  ),
);
const hasUsage = computed(() => chart.value.grandTotal > 0);

// Sparse axis ticks — about six labels regardless of range.
const tickEvery = computed(() => Math.max(1, Math.ceil(rangeDays.value / 6)));

function segmentHeightPercent(totalTokens: number): number {
  if (chart.value.maxDayTotal === 0) return 0;
  return (totalTokens / chart.value.maxDayTotal) * 100;
}

const chartSummary = computed(
  () =>
    `${formatTokenCount(chart.value.grandTotal)} tokens across ` +
    `${chart.value.series.map((entry) => entry.label).join(", ")} ` +
    `over the last ${rangeDays.value} days`,
);
</script>

<template>
  <section class="card span-2">
    <header class="card-header">
      <BarChart3 :size="14" class="card-icon" />
      <p class="card-title">Usage</p>
      <span v-if="hasUsage" class="card-total">
        {{ formatTokenCount(chart.grandTotal) }} tokens
      </span>
      <div class="range-toggle" role="group" aria-label="Usage range">
        <button
          v-for="option in RANGE_OPTIONS"
          :key="option.days"
          type="button"
          class="range-chip"
          :class="{ 'is-active': rangeDays === option.days }"
          @click="rangeDays = option.days"
        >
          {{ option.label }}
        </button>
      </div>
    </header>

    <EmptyState
      v-if="!hasUsage"
      title="No usage yet"
      hint="Once Claude starts working, daily token usage per model lands here."
    />

    <template v-else>
      <div class="chart" role="img" :aria-label="chartSummary">
        <div class="gridlines" aria-hidden="true">
          <div class="gridline">
            <span class="gridline-label">
              {{ formatTokenCount(chart.maxDayTotal) }}
            </span>
          </div>
          <div class="gridline is-mid">
            <span class="gridline-label">
              {{ formatTokenCount(Math.round(chart.maxDayTotal / 2)) }}
            </span>
          </div>
        </div>
        <div class="columns">
          <div
            v-for="(day, index) in chart.days"
            :key="day.day"
            class="column"
            :class="{ 'is-tooltip-left': index > chart.days.length * 0.7 }"
          >
            <div class="bar">
              <div
                v-for="segment in day.segments"
                :key="segment.key"
                class="segment"
                :style="{
                  height: `${segmentHeightPercent(segment.totalTokens)}%`,
                  background: `var(${segment.colorVar})`,
                }"
              />
            </div>
            <span class="tick">
              {{ index % tickEvery === 0 ? day.label : "" }}
            </span>
            <div v-if="day.totalTokens > 0" class="tooltip" role="tooltip">
              <p class="tooltip-day">{{ day.label }}</p>
              <p
                v-for="segment in day.segments"
                :key="segment.key"
                class="tooltip-row"
              >
                <span
                  class="legend-dot"
                  :style="{ background: `var(${segment.colorVar})` }"
                />
                {{ segment.label }} ·
                {{ formatTokenCount(segment.inputTokens) }} in ·
                {{ formatTokenCount(segment.outputTokens) }} out
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="legend">
        <span
          v-for="entry in chart.series"
          :key="entry.key"
          class="legend-item"
        >
          <span
            class="legend-dot"
            :style="{ background: `var(${entry.colorVar})` }"
          />
          {{ entry.label }}
        </span>
        <span class="legend-note">
          Input counts include the conversation context each reply reads.
        </span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.card {
  background: var(--bg-panel);
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  padding: 12px;
  display: grid;
  gap: 4px;
  align-content: start;
}

.span-2 {
  grid-column: span 2;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 4px;
}

.card-icon {
  color: var(--ink-3);
}

.card-title {
  margin: 0;
  color: var(--ink-2);
  font: 600 11px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.card-total {
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}

.range-toggle {
  margin-left: auto;
  display: flex;
  gap: 2px;
}

.range-chip {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 3px 8px;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-3);
  font: 500 11px/1.4 var(--font-ui);
  cursor: default;
}

.range-chip:hover {
  background: var(--row-hover);
}

.range-chip.is-active {
  background: var(--row-active);
  color: var(--ink-1);
}

.range-chip:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.chart {
  position: relative;
  height: 132px;
  margin-top: 6px;
}

.gridlines {
  position: absolute;
  /* Leave room for the tick row below the plot. */
  inset: 0 0 18px;
}

.gridline {
  position: absolute;
  inset-inline: 0;
  top: 0;
  border-top: 1px solid var(--hair);
}

.gridline.is-mid {
  top: 50%;
}

.gridline-label {
  position: absolute;
  right: 0;
  top: -14px;
  color: var(--ink-3);
  font: 400 9.5px/1.4 var(--font-ui);
}

.columns {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: stretch;
  gap: 2px;
}

.column {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: grid;
  grid-template-rows: 1fr 18px;
}

.column:hover {
  background: var(--row-hover);
  border-radius: var(--radius-s);
}

.bar {
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 2px;
}

.segment {
  width: min(62%, 14px);
  min-height: 2px;
}

/* The topmost segment wears the rounded data-end; the stack stays anchored
   flat on the baseline. */
.segment:last-child {
  border-radius: 4px 4px 0 0;
}

.tick {
  color: var(--ink-3);
  font: 400 9.5px/1.8 var(--font-ui);
  text-align: center;
  white-space: nowrap;
  overflow: visible;
}

.tooltip {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: none;
  padding: 7px 9px;
  border-radius: var(--radius-s);
  background: var(--bg-raised);
  border: 1px solid var(--hair-strong);
  box-shadow: var(--shadow-raised);
  white-space: nowrap;
}

.column.is-tooltip-left .tooltip {
  left: auto;
  right: 0;
  transform: none;
}

.column:hover .tooltip {
  display: block;
}

.tooltip-day {
  margin: 0 0 2px;
  color: var(--ink-1);
  font: 600 11px/1.5 var(--font-ui);
}

.tooltip-row {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--ink-2);
  font: 400 11px/1.6 var(--font-ui);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ink-2);
  font: 400 11px/1.5 var(--font-ui);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.legend-note {
  margin-left: auto;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
}

@media (max-width: 860px) {
  .span-2 {
    grid-column: span 1;
  }

  .legend-note {
    margin-left: 0;
    flex-basis: 100%;
  }
}
</style>
