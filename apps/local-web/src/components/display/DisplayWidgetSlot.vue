<script setup lang="ts">
import type { DisplayWidgetView } from "@vynel/contracts/display/display-widget";
import DisplayWidget from "./DisplayWidget.vue";

// One named region of the board. The empty hint lives HERE rather than in the
// view so the three slots cannot drift into three different ideas of what an
// empty slot looks like — and so the room says "nothing here yet" exactly
// where something will land.
const props = defineProps<{
  /** `left` | `stage` | `right` — the region's name, for the test ids. */
  name: string;
  widgets: ReadonlyArray<DisplayWidgetView>;
  hint: string;
}>();
</script>

<template>
  <div class="widget-slot-list" :data-testid="`display-widgets-${props.name}`">
    <DisplayWidget
      v-for="widget in props.widgets"
      :key="widget.id"
      :widget="widget"
    />
    <div
      v-if="props.widgets.length === 0"
      class="widget-slot"
      :data-testid="`display-slot-${props.name}`"
    >
      {{ props.hint }}
    </div>
  </div>
</template>

<style scoped>
.widget-slot-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* Deliberately faint: an empty slot is a promise, not furniture. */
.widget-slot {
  border: 1px dashed var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  padding: 10px;
  text-align: center;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}
</style>
