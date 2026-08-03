<script setup lang="ts">
import { computed } from "vue";

// The assistant's identity glyph — Claude's starburst spark, drawn as
// round-capped rays with organically alternating reach. Colored by the
// `--claude-mark` token (identity), never gold (presence). Pure SVG so it
// scales anywhere: hero centerpiece, labels, the future tray icon.
const props = withDefaults(
  defineProps<{
    size?: number;
  }>(),
  { size: 64 },
);

// Outer radius per ray (viewBox 100) — uneven on purpose; a perfectly regular
// asterisk reads as a generic sun, the alternation reads as the spark.
const RAY_REACH = [46, 34, 43, 36, 46, 35, 44, 34, 46, 36, 43, 35];

// Below ~24px the twelve rays converge into a blob (the center hole shrinks
// to a pixel or two) — tiny renders get eight rays with a wider gap and a
// heavier stroke, which stays a crisp spark at label size.
const COMPACT_RAY_REACH = [46, 38, 46, 38, 46, 38, 46, 38];

const isCompact = computed(() => props.size < 24);

const rays = computed(() => {
  const reaches = isCompact.value ? COMPACT_RAY_REACH : RAY_REACH;
  const step = 360 / reaches.length;
  return reaches.map((reach, index) => ({
    angle: index * step,
    reach,
  }));
});

const innerY = computed(() => (isCompact.value ? 28 : 36));
const strokeWidth = computed(() => (isCompact.value ? 11 : 8.5));
</script>

<template>
  <svg
    class="claude-mark"
    :width="props.size"
    :height="props.size"
    viewBox="0 0 100 100"
    fill="none"
    aria-hidden="true"
  >
    <line
      v-for="ray in rays"
      :key="ray.angle"
      x1="50"
      :y1="innerY"
      x2="50"
      :y2="50 - ray.reach"
      stroke="currentColor"
      :stroke-width="strokeWidth"
      stroke-linecap="round"
      :transform="`rotate(${ray.angle} 50 50)`"
    />
  </svg>
</template>

<style scoped>
.claude-mark {
  display: block;
  color: var(--claude-mark);
}
</style>
