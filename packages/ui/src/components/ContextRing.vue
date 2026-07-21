<script setup lang="ts">
import { computed } from "vue";

// The composer's context ring (Claude-desktop parity): a small arc showing how
// full the current session's context window is. Data-blind — the host computes
// the fraction and the tooltip. Amber from 70%; the tick marks 85%, where the
// conversation continues automatically (the ring visibly resets after a swap).
const props = defineProps<{
  /** Occupancy 0..1 (clamped). */
  fraction: number;
  /** Plain-language breakdown, e.g. "~166k of 200k · continues automatically near 85%". */
  tooltip?: string | undefined;
  /** Outer diameter in px. */
  size?: number | undefined;
}>();

const clamped = computed(() => Math.min(1, Math.max(0, props.fraction)));
const percent = computed(() => Math.round(clamped.value * 100));
const isWarn = computed(() => clamped.value >= 0.7);

const diameter = computed(() => props.size ?? 18);
const STROKE = 2;
const radius = computed(() => (diameter.value - STROKE) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const dashOffset = computed(() => circumference.value * (1 - clamped.value));

// The 85% tick, on the same -90°-rotated circle the arc draws on.
const swapAngle = 0.85 * 2 * Math.PI - Math.PI / 2;
function tickPoint(distance: number): { x: number; y: number } {
  return {
    x: diameter.value / 2 + distance * Math.cos(swapAngle),
    y: diameter.value / 2 + distance * Math.sin(swapAngle),
  };
}
const tickInner = computed(() => tickPoint(radius.value - STROKE));
const tickOuter = computed(() => tickPoint(radius.value + STROKE / 2));
</script>

<template>
  <span
    class="context-ring"
    :class="{ 'is-warn': isWarn }"
    role="meter"
    :aria-valuenow="percent"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="props.tooltip ?? `Context ${percent}% full`"
    :title="props.tooltip"
  >
    <svg
      :width="diameter"
      :height="diameter"
      :viewBox="`0 0 ${diameter} ${diameter}`"
      aria-hidden="true"
    >
      <circle
        class="ring-track"
        :cx="diameter / 2"
        :cy="diameter / 2"
        :r="radius"
        fill="none"
        :stroke-width="STROKE"
      />
      <circle
        class="ring-fill"
        :cx="diameter / 2"
        :cy="diameter / 2"
        :r="radius"
        fill="none"
        :stroke-width="STROKE"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        :transform="`rotate(-90 ${diameter / 2} ${diameter / 2})`"
      />
      <line
        class="swap-mark"
        :x1="tickInner.x"
        :y1="tickInner.y"
        :x2="tickOuter.x"
        :y2="tickOuter.y"
        stroke-width="1"
      />
    </svg>
  </span>
</template>

<style scoped>
.context-ring {
  display: inline-grid;
  place-items: center;
}

.ring-track {
  stroke: var(--row-active);
}

.ring-fill {
  stroke: var(--ink-3);
  transition: stroke-dashoffset 300ms var(--ease-out, ease-out);
}

.context-ring.is-warn .ring-fill {
  stroke: var(--gold);
}

/* The 85% line — where the conversation continues automatically. */
.swap-mark {
  stroke: var(--hair-strong);
}
</style>
