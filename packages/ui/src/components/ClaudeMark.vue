<script setup lang="ts">
// The assistant's identity glyph — Claude's starburst spark, drawn as twelve
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

const rays = RAY_REACH.map((reach, index) => ({
  angle: index * 30,
  reach,
}));
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
      y1="36"
      x2="50"
      :y2="50 - ray.reach"
      stroke="currentColor"
      stroke-width="8.5"
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
