<script setup lang="ts">
import { computed } from "vue";
// A Display readout: corner-ticked chrome, small-caps labels, one value per
// row. Data-blind — the host decides what a row says and how loud it is.
export type DisplayPanelTone = "default" | "attention" | "live" | "muted";

export interface DisplayPanelRow {
  label: string;
  value: string;
  tone?: DisplayPanelTone | undefined;
}

const props = defineProps<{
  title: string;
  rows: ReadonlyArray<DisplayPanelRow>;
  /** Fix the readout to this many rows. A log that grows with every event
   *  pushes the panels below it around the room; a fixed window keeps the
   *  layout still and shows only what just happened. */
  lines?: number | undefined;
}>();

const rowsStyle = computed(() =>
  props.lines === undefined
    ? undefined
    : { height: `calc(${props.lines} * 1.75em)`, overflow: "hidden" },
);
</script>

<template>
  <section class="display-panel">
    <span class="tick tl" aria-hidden="true" />
    <span class="tick tr" aria-hidden="true" />
    <span class="tick bl" aria-hidden="true" />
    <span class="tick br" aria-hidden="true" />
    <h4 class="panel-title">{{ props.title }}</h4>
    <div class="panel-rows" :style="rowsStyle" data-testid="panel-rows">
      <div
        v-for="(row, index) in props.rows"
        :key="`${index}-${row.label}`"
        class="panel-row"
      >
        <span class="row-label">{{ row.label }}</span>
        <span class="row-value" :class="`is-${row.tone ?? 'default'}`">{{
          row.value
        }}</span>
      </div>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.display-panel {
  position: relative;
  border: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  background: var(--display-panel-bg, rgba(3, 14, 26, 0.55));
  border-radius: var(--display-panel-radius, 0px);
  padding: 9px 11px;
  font-size: 10px;
  line-height: 1.75;
}

.panel-title {
  margin: 0 0 6px;
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

/* The little corner brackets on every panel — the demo's one piece of chrome. */
.tick {
  position: absolute;
  width: 7px;
  height: 7px;
  border: 1px solid var(--display-accent, #4fd8ff);
  opacity: 0.8;
}

.tick.tl {
  top: -1px;
  left: -1px;
  border-right: 0;
  border-bottom: 0;
}

.tick.tr {
  top: -1px;
  right: -1px;
  border-left: 0;
  border-bottom: 0;
}

.tick.bl {
  bottom: -1px;
  left: -1px;
  border-right: 0;
  border-top: 0;
}

.tick.br {
  bottom: -1px;
  right: -1px;
  border-left: 0;
  border-top: 0;
}

.panel-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

/* Values never wrap: a long line truncates so one event is always one row. */
.row-value {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 72%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--display-text, #cdf3ff);
  text-shadow: 0 0 8px var(--display-glow, rgba(79, 216, 255, 0.6));
}

.row-value.is-attention {
  color: var(--display-attention, #ffc46b);
  text-shadow: 0 0 8px var(--display-attention-glow, rgba(255, 196, 107, 0.6));
}

.row-value.is-live {
  color: var(--display-accent, #4fd8ff);
  text-shadow: 0 0 10px var(--display-glow, rgba(79, 216, 255, 0.85));
}

.row-value.is-muted {
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
  text-shadow: none;
}
</style>
