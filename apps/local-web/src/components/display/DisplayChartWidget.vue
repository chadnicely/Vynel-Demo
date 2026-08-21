<script setup lang="ts">
import { computed } from "vue";
import type { ChartWidgetContent } from "@vynel/contracts/display/display-widget-content";
import { CHART_VIEWBOX, DONUT, buildDisplayChart } from "./display-chart-geometry.js";

// OUR OWN SVG, deliberately: a charting library would be a second styling
// system inside a room that is four CSS variables and a canvas, and it would
// ship a whole renderer to draw at most four series. The arithmetic lives in
// `display-chart-geometry.ts`; this file is the drawing.
const props = defineProps<{ content: ChartWidgetContent }>();

const chart = computed(() => buildDisplayChart(props.content));

const viewBox = `0 0 ${CHART_VIEWBOX.width} ${CHART_VIEWBOX.height}`;
/** Slices start at twelve o'clock, where a reader starts. */
const donutRotation = `rotate(-90 ${DONUT.cx} ${DONUT.cy})`;
const axisBaselineY = CHART_VIEWBOX.height - 6;

function strokeOf(colorVar: string): Record<string, string> {
  return { stroke: `var(${colorVar})` };
}

function fillOf(colorVar: string): Record<string, string> {
  return { fill: `var(${colorVar})` };
}
</script>

<template>
  <div class="display-chart" data-testid="display-widget-chart">
    <!-- Scales to whatever width the slot gives it — no measuring, no resize
         observer, and the same drawing in a column or on the stage. -->
    <svg :viewBox="viewBox" role="img" preserveAspectRatio="xMidYMid meet">
      <title>{{ chart.title }}</title>

      <template v-if="chart.type === 'bar'">
        <rect
          v-for="bar in chart.bars"
          :key="bar.key"
          class="bar"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          :style="fillOf(bar.colorVar)"
        />
      </template>

      <template v-else-if="chart.type === 'line'">
        <g v-for="line in chart.lines" :key="line.key">
          <polyline class="line" :points="line.polyline" :style="strokeOf(line.colorVar)" />
          <circle
            v-for="(dot, index) in line.dots"
            :key="index"
            class="dot"
            :cx="dot.x"
            :cy="dot.y"
            r="2.2"
            :style="fillOf(line.colorVar)"
          />
        </g>
      </template>

      <g v-else-if="chart.type === 'donut'" :transform="donutRotation">
        <circle
          class="ring"
          :cx="DONUT.cx"
          :cy="DONUT.cy"
          :r="DONUT.radius"
          :stroke-width="DONUT.thickness"
        />
        <circle
          v-for="arc in chart.arcs"
          :key="arc.key"
          class="arc"
          :cx="DONUT.cx"
          :cy="DONUT.cy"
          :r="DONUT.radius"
          :stroke-width="DONUT.thickness"
          :stroke-dasharray="arc.dashArray"
          :stroke-dashoffset="arc.dashOffset"
          :style="strokeOf(arc.colorVar)"
        />
      </g>

      <template v-if="chart.type !== 'donut'">
        <text
          v-for="tick in chart.axis"
          :key="tick.label"
          class="axis-label"
          :x="tick.x"
          :y="axisBaselineY"
          text-anchor="middle"
        >
          {{ tick.label }}
        </text>
      </template>
    </svg>

    <ul v-if="chart.legend.length > 1" class="legend" data-testid="display-chart-legend">
      <li v-for="entry in chart.legend" :key="entry.label">
        <span class="swatch" :style="fillOf(entry.colorVar)" />{{ entry.label }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* The four series colours are re-pinned to their DARK values here. They are
   app tokens that follow the app THEME, while the Display paints its own dark
   ground whatever the theme is (display-root.css) — so the light-theme set,
   tuned for a white page, would go muddy on this ground. Same hexes as
   `packages/ui/src/styles/tokens.css`'s `:root` block. */
.display-chart {
  --chart-1: #0fa78d;
  --chart-2: #6a93e6;
  --chart-3: #d15f83;
  --chart-4: #7d55c7;

  display: flex;
  flex-direction: column;
  gap: 6px;
}

svg {
  width: 100%;
  height: auto;
  overflow: visible;
}

.bar {
  opacity: 0.9;
}

.line {
  fill: none;
  stroke-width: 1.6;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.ring {
  fill: none;
  stroke: var(--display-accent-faint, rgba(79, 216, 255, 0.16));
}

.arc {
  fill: none;
}

.axis-label {
  fill: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
  font-size: 8px;
  letter-spacing: 0.1em;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

.legend li {
  display: flex;
  align-items: center;
  gap: 5px;
}

.swatch {
  width: 7px;
  height: 7px;
  border-radius: 1px;
}
</style>
