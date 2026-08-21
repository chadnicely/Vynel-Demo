<script setup lang="ts">
import { computed, type Component } from "vue";
import {
  PhBroadcast as Broadcast,
  PhCornersIn as CornersIn,
  PhCornersOut as CornersOut,
  PhLayout as Layout,
  PhShareNetwork as ShareNetwork,
} from "@phosphor-icons/vue";
import type { ViewMode } from "../../composables/shell/use-view-mode.js";

// The title bar's view switch — Nodes | Display | Normal on one chamfered
// plate (Kafi, 2026-08-22: "a beautiful shape, like a game widget"), with the
// full-view expander riding its trailing edge whenever the view on screen can
// fill the window. Data-blind: it shows the mode it is handed and emits what
// was picked; the shell decides what each pick does.
const props = defineProps<{
  mode: ViewMode;
  /** The Display feature holds this window's voice — its segment glows even
   *  while another view is on screen, exactly as the retired Broadcast glyph
   *  did, so a running conversation is never invisible. */
  displayLive: boolean;
  fullView: boolean;
}>();

const emit = defineEmits<{
  pick: [mode: ViewMode];
  "toggle-full-view": [];
}>();

const SEGMENTS: ReadonlyArray<{ id: ViewMode; label: string; icon: Component }> = [
  { id: "nodes", label: "Nodes", icon: ShareNetwork },
  { id: "display", label: "Display", icon: Broadcast },
  { id: "normal", label: "Normal view", icon: Layout },
];

// The plate wears the Display's palette only while it sits over the Display
// with the chrome gone — anywhere else it is quiet chrome like the rest of
// the bar, so the normal view looks exactly as it always did.
const skin = computed(() =>
  props.fullView && props.mode === "display" ? "display" : "chrome",
);
</script>

<template>
  <div class="view-switch" :data-skin="skin" role="group" aria-label="View">
    <div class="rim">
      <div class="plate">
        <button
          v-for="segment in SEGMENTS"
          :key="segment.id"
          type="button"
          class="segment"
          :class="{
            on: segment.id === props.mode,
            live: segment.id === 'display' && props.displayLive,
          }"
          :aria-label="segment.label"
          :title="segment.label"
          :aria-pressed="segment.id === props.mode"
          @click="emit('pick', segment.id)"
        >
          <component :is="segment.icon" :size="13" />
        </button>
        <!-- Only where there is a full view to go to: the normal view never
             expands, so offering it there would be a control that does
             nothing. -->
        <button
          v-if="props.mode !== 'normal'"
          type="button"
          class="segment expand"
          :aria-label="props.fullView ? 'Exit full view' : 'Full view'"
          :title="props.fullView ? 'Exit full view' : 'Full view'"
          :aria-pressed="props.fullView"
          @click="emit('toggle-full-view')"
        >
          <component :is="props.fullView ? CornersIn : CornersOut" :size="13" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-switch {
  --switch-line: var(--hair);
  --switch-bg: var(--bg-panel);
  --switch-ink: var(--ink-3);
  --switch-ink-hover: var(--ink-1);
  --switch-on-bg: var(--row-active);
  --switch-on-ink: var(--ink-1);
  --switch-live: var(--color-accent-200);
  /* The chamfer — a hex-ended plate. One polygon shared by the rim and the
     face, so the 1px rim follows the cut exactly. */
  --switch-cut: 7px;
  --switch-shape: polygon(
    var(--switch-cut) 0,
    calc(100% - var(--switch-cut)) 0,
    100% 50%,
    calc(100% - var(--switch-cut)) 100%,
    var(--switch-cut) 100%,
    0 50%
  );
  display: inline-flex;
}

.view-switch[data-skin="display"] {
  --switch-line: var(--display-accent-dim);
  --switch-bg: rgba(2, 19, 43, 0.72);
  --switch-ink: var(--display-accent-dim);
  --switch-ink-hover: var(--display-text);
  --switch-on-bg: var(--display-accent);
  --switch-on-ink: var(--display-ground-top);
  --switch-live: var(--display-accent);
  /* The glow lives on this outer, unclipped box — clip-path on the rim would
     cut its own shadow off — and only on this skin: a filter costs a
     compositing layer, and the chrome plate has nothing to glow with. */
  filter: drop-shadow(0 0 6px var(--display-accent-faint));
}

.rim {
  padding: 1px;
  clip-path: var(--switch-shape);
  background: var(--switch-line);
}

.plate {
  display: flex;
  align-items: stretch;
  padding: 0 5px;
  clip-path: var(--switch-shape);
  background: var(--switch-bg);
}

.segment {
  appearance: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--switch-ink);
  cursor: default;
  transition:
    color 120ms ease,
    background 120ms ease;
}

.segment:hover {
  color: var(--switch-ink-hover);
}

.segment.live {
  color: var(--switch-live);
}

.segment.on {
  background: var(--switch-on-bg);
  color: var(--switch-on-ink);
}

.expand {
  margin-left: 3px;
  border-left: 1px solid var(--switch-line);
}
</style>
