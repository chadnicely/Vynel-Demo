<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { figureParts, formatFigure } from "../../demo/demo-figure-parts.js";

// A figure that ARRIVES rather than appears (Chad, 2026-08-29). On camera a
// number that pops into place reads as a slide; one that rolls up to itself in
// half a second reads as a machine counting something real.
//
// It eases out, so most of the distance is covered in the first third and the
// last hundred crawl — the shape a counter has when it is settling on a total.
const props = defineProps<{ value: string; durationMs?: number }>();

const ROLL_MS = 620;

const parts = computed(() => figureParts(props.value));
const shown = ref(props.value);

let frame = 0;
const stop = () => {
  if (frame !== 0) cancelAnimationFrame(frame);
  frame = 0;
};

/** A machine told to keep still shows the total, not a blur of digits. */
const stillPlease = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function roll(): void {
  stop();
  const target = parts.value;
  if (target === null || stillPlease() || typeof requestAnimationFrame !== "function") {
    shown.value = props.value;
    return;
  }
  const span = props.durationMs ?? ROLL_MS;
  const startedAt = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / span);
    const eased = 1 - (1 - progress) ** 3;
    shown.value = formatFigure(target, target.amount * eased);
    if (progress < 1) frame = requestAnimationFrame(tick);
    else {
      frame = 0;
      // Land on the written figure exactly — the eased last frame can round to
      // a hair under, and "$1,507" on screen while the voice says 1,508 is the
      // one mistake the audience will catch.
      shown.value = props.value;
    }
  };
  frame = requestAnimationFrame(tick);
}

watch(() => props.value, roll, { immediate: true });
onBeforeUnmount(stop);
</script>

<template>
  <span class="count-up" :aria-label="value">{{ shown }}</span>
</template>

<style scoped>
.count-up {
  font-variant-numeric: tabular-nums;
}
</style>
