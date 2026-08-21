<script setup lang="ts">
import type { DisplayWidgetView } from "@vynel/contracts/display/display-widget";
import type { DisplayWidgetKind } from "@vynel/contracts/display/display-widget-content";
import { useRemoveDisplayWidget } from "../../composables/display/use-remove-display-widget.js";
import DisplayChartWidget from "./DisplayChartWidget.vue";
import DisplayMarkdownWidget from "./DisplayMarkdownWidget.vue";
import DisplayMetricWidget from "./DisplayMetricWidget.vue";
import DisplayTableWidget from "./DisplayTableWidget.vue";

// The frame every card on the board wears: what it is called, what kind of
// thing it is, and the one control the user has over it. The KINDS themselves
// know nothing about the board — each renderer takes only its own content, so
// none of them can reach the SDK or the scope.
const props = defineProps<{ widget: DisplayWidgetView }>();

/** A callsign rather than an icon: the room is monospace on a scanline
 *  ground, and three letters sit in it where a drawn glyph would not. */
const KIND_GLYPHS: Record<DisplayWidgetKind, string> = {
  markdown: "TXT",
  table: "TBL",
  metric: "NUM",
  chart: "CHT",
};

const removal = useRemoveDisplayWidget();

// The card leaves on the click and comes back if the request failed — see
// `use-remove-display-widget` for why the live frame is not enough on its own.
function remove(): void {
  removal.mutate(props.widget.id);
}
</script>

<template>
  <section
    class="display-widget"
    :class="`is-${props.widget.size}`"
    data-testid="display-widget"
  >
    <header>
      <span class="kind" aria-hidden="true">{{ KIND_GLYPHS[props.widget.kind] }}</span>
      <h4 class="title">{{ props.widget.title }}</h4>
      <button
        type="button"
        class="remove"
        :class="{ failed: removal.isError.value }"
        :disabled="removal.isPending.value"
        :aria-label="`Remove ${props.widget.title}`"
        :title="removal.isError.value ? 'Removing failed — try again' : 'Remove'"
        data-testid="display-widget-remove"
        @click="remove"
      >
        ×
      </button>
    </header>

    <div class="body">
      <DisplayMarkdownWidget
        v-if="props.widget.content.kind === 'markdown'"
        :content="props.widget.content"
      />
      <DisplayTableWidget
        v-else-if="props.widget.content.kind === 'table'"
        :content="props.widget.content"
      />
      <DisplayMetricWidget
        v-else-if="props.widget.content.kind === 'metric'"
        :content="props.widget.content"
      />
      <DisplayChartWidget v-else :content="props.widget.content" />
    </div>
  </section>
</template>

<style scoped>
/* Same ground and hairline as `DisplayPanel`, deliberately without its corner
   ticks: the panels are the APP reading itself back, these are what Claude
   put up. One family, two voices. */
.display-widget {
  border: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  background: rgba(3, 14, 26, 0.55);
  padding: 9px 11px 10px;
  min-width: 0;
}

header {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-bottom: 7px;
}

.kind {
  font-size: 8px;
  letter-spacing: 0.18em;
  color: var(--display-accent, #4fd8ff);
  opacity: 0.75;
}

.title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

.remove {
  border: 0;
  background: transparent;
  padding: 0 2px;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
  cursor: pointer;
  transition: color 120ms ease;
}

.remove:hover:not(:disabled) {
  color: var(--display-text, #cdf3ff);
}

.remove:disabled {
  cursor: default;
  opacity: 0.4;
}

.remove.failed {
  color: var(--display-attention, #ffc46b);
}

/* Size is a HEIGHT budget: a card gets the room its author asked for and
   scrolls inside itself past that — the page behind it never scrolls because
   a table came back wider or longer than expected. */
.body {
  max-height: var(--widget-body-max);
  overflow: auto;
}

.is-sm {
  --widget-body-max: 110px;
}

.is-md {
  --widget-body-max: 220px;
}

.is-lg {
  --widget-body-max: 360px;
}
</style>
