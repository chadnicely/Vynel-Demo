<script setup lang="ts">
import { computed } from "vue";

// A small horizontal context-occupancy meter: how full a session's context
// window is. Data-blind — the host computes the fraction and the tooltip.
// Amber from 70% (getting full); the tick marks 85%, where the conversation
// continues automatically into a fresh session.
const props = defineProps<{
  /** Occupancy 0..1 (clamped). */
  fraction: number;
  /** Plain-language breakdown, e.g. "~166k of 200k · continues automatically near 85%". */
  tooltip?: string | undefined;
}>();

const clamped = computed(() => Math.min(1, Math.max(0, props.fraction)));
const percent = computed(() => Math.round(clamped.value * 100));
const isWarn = computed(() => clamped.value >= 0.7);
</script>

<template>
  <span
    class="context-meter"
    :class="{ 'is-warn': isWarn }"
    role="meter"
    :aria-valuenow="percent"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="props.tooltip ?? `Context ${percent}% full`"
    :title="props.tooltip"
  >
    <span class="track">
      <span class="fill" :style="{ width: `${percent}%` }" />
      <span class="swap-mark" aria-hidden="true" />
    </span>
    <span class="readout">{{ percent }}%</span>
  </span>
</template>

<style scoped>
.context-meter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.track {
  position: relative;
  width: 56px;
  height: 4px;
  border-radius: 99px;
  background: var(--row-active);
  overflow: hidden;
}

.fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 99px;
  background: var(--ink-3);
  transition: width 300ms var(--ease-out, ease-out);
}

.context-meter.is-warn .fill {
  background: var(--gold);
}

/* The 85% line — where the conversation continues automatically. */
.swap-mark {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 85%;
  width: 1px;
  background: var(--hair-strong);
}

.readout {
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
}

.context-meter.is-warn .readout {
  color: var(--gold);
}
</style>
