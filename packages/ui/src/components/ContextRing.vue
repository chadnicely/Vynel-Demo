<script setup lang="ts">
import { computed } from "vue";

// The context ring — ONE home for "how full is this conversation's window"
// (the composer's model chip and every session row wear it): a small arc
// filling to the occupancy, in the tier's colour. Blue while there is room,
// yellow in the last stretch before the ~85% auto-continue, red past it
// (Kafi, 2026-08-25 — the colour replaced the old 85% tick). Data-blind —
// the host computes the fraction and the tooltip.
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
const tier = computed<"low" | "high" | "critical">(() =>
  percent.value < 75 ? "low" : percent.value <= 85 ? "high" : "critical",
);

const diameter = computed(() => props.size ?? 14);
const STROKE = 2;
const radius = computed(() => (diameter.value - STROKE) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const dashOffset = computed(() => circumference.value * (1 - clamped.value));
</script>

<template>
  <span
    class="context-ring"
    :data-tier="tier"
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
      <!-- A round cap keeps even a few percent visible as a dot. -->
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
    </svg>
  </span>
</template>

<style scoped>
/* One tier, one colour — both circles stroke currentColor, so the tier sets
   the whole ring. */
.context-ring {
  display: inline-grid;
  place-items: center;
  color: var(--needs-input);
}

.context-ring[data-tier="high"] {
  color: var(--warning);
}

.context-ring[data-tier="critical"] {
  color: var(--danger);
}

.ring-track {
  stroke: currentColor;
  stroke-opacity: 0.22;
}

.ring-fill {
  stroke: currentColor;
  transition: stroke-dashoffset 300ms var(--ease-out, ease-out);
}
</style>
