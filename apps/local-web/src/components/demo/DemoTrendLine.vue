<script setup lang="ts">
import { computed } from "vue";
import { figureTrend, trendPath } from "../../demo/demo-figure-trend.js";

// The week behind a spoken figure — a sparkline and one plain sentence
// (Chad, 2026-08-29). A number alone is a claim; a number with a shape behind
// it reads as something that has been watched for a while.
//
// The shape is derived from the figure, not measured: see `demo-figure-trend`.
const props = defineProps<{ label: string; value: string }>();

const WIDTH = 86;
const HEIGHT = 22;

const trend = computed(() => figureTrend(props.label, props.value));
const path = computed(() => trendPath(trend.value.points, WIDTH, HEIGHT));
</script>

<template>
  <span class="trend" :class="trend.direction">
    <svg
      class="spark"
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      :width="WIDTH"
      :height="HEIGHT"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path :d="path" fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
    <span class="arrow">{{ trend.direction === "up" ? "▲" : "▼" }}</span>
    <span class="trend-caption">{{ trend.caption }}</span>
  </span>
</template>

<style scoped>
.trend {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--display-accent-dim, #9fd8f0);
  font: 600 12px var(--display-font, ui-monospace, monospace);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  white-space: nowrap;
}
.trend.up {
  color: var(--display-accent, #6ee7a5);
}
.trend.down {
  color: var(--display-attention, #ffc46b);
}
.spark {
  overflow: visible;
  /* It draws itself in as the figure lands, left to right. */
  stroke-dasharray: 260;
  stroke-dashoffset: 260;
  animation: spark-draw 700ms 120ms var(--ease-out, ease-out) forwards;
}
.arrow {
  font-size: 10px;
}

/* NOT `.caption`: the room hides every element by that name on purpose
   (display-themes.css — the voice caption is two grey bars on camera), and
   the rule is unscoped, so it reached in here and hid the words beside the
   sparkline while the line itself drew fine. */
.trend-caption {
  white-space: nowrap;
}

@keyframes spark-draw {
  to {
    stroke-dashoffset: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spark {
    animation: none;
    stroke-dashoffset: 0;
  }
}
</style>
