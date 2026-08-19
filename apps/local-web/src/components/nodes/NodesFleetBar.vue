<script setup lang="ts">
import { computed } from "vue";
import { PhCaretLeft as ChevronLeft } from "@phosphor-icons/vue";
import type { NodesMode } from "../../stores/ui-store.js";
import type { SceneNode } from "../../utils/constellation-scene.js";

// The node screen's own bar: where you are standing, the three readings of
// the same projects, and the counts beside them. Data-blind — it renders what
// it is handed and emits what was clicked.
const props = defineProps<{
  mode: NodesMode;
  /** Where you are standing, outermost first. Empty out on the fleet. */
  trail: readonly string[];
  nodes: readonly SceneNode[];
  /** The level's reads have answered. Until they have, the counts below would
   *  be a claim made from data we do not have — every project falling to its
   *  grey fallback read as "N idle" for the whole poll flight (2026-08-19
   *  audit, agent-4 §5a). */
  hasAnswered: boolean;
}>();

const emit = defineEmits<{
  "update:mode": [mode: NodesMode];
  back: [];
  "open-chat": [];
}>();

const MODES: Array<{ id: NodesMode; label: string }> = [
  { id: "nodes", label: "Nodes" },
  { id: "grid", label: "Grid" },
  { id: "race", label: "Race" },
];

const isDrilled = computed(() => props.trail.length > 0);
/** Where `back` lands — the level above, or the fleet at the first step in. */
const backLabel = computed(
  () => props.trail[props.trail.length - 2] ?? "All projects",
);
const hereLabel = computed(() => props.trail[props.trail.length - 1] ?? "");

// One vocabulary with the dots (Kafi, 2026-08-17). `problem` used to have no
// chip at all here, so a failed project was counted under "paused" — the bar
// contradicting the red dot beside it.
const counts = computed(() => ({
  problem: props.nodes.filter((row) => row.status === "problem").length,
  building: props.nodes.filter((row) => row.status === "building").length,
  waiting: props.nodes.filter((row) => row.status === "waiting").length,
  done: props.nodes.filter((row) => row.status === "done").length,
  paused: props.nodes.filter((row) => row.status === "idle").length,
}));
</script>

<template>
  <header class="fleet-bar">
    <!-- Where you are standing: All projects, or one project's inside. -->
    <button
      v-if="isDrilled"
      type="button"
      class="crumb"
      @click="emit('back')"
    >
      <ChevronLeft :size="13" /> {{ backLabel }}
    </button>
    <span v-if="isDrilled" class="crumb-here">{{ hereLabel }}</span>
    <nav class="modes" aria-label="Fleet view">
      <button
        v-for="option in MODES"
        :key="option.id"
        type="button"
        class="mode-btn"
        :class="{ on: option.id === props.mode }"
        :aria-pressed="option.id === props.mode"
        @click="emit('update:mode', option.id)"
      >
        {{ option.label }}
      </button>
      <!-- Inside a project the chat is the fourth reading (Chad,
           2026-08-11): nodes ↔ chat, back and forth, same software. -->
      <button
        v-if="isDrilled"
        type="button"
        class="mode-btn"
        @click="emit('open-chat')"
      >
        Chat
      </button>
    </nav>
    <p v-if="props.hasAnswered" class="counts">
      <span v-if="counts.problem" class="count"
        ><i class="dot problem" />{{ counts.problem }} need attention</span
      >
      <span class="count"
        ><i class="dot building" />{{ counts.building }} working</span
      >
      <span v-if="counts.waiting" class="count"
        ><i class="dot waiting" />{{ counts.waiting }} waiting on you</span
      >
      <span v-if="counts.done" class="count"
        ><i class="dot done" />{{ counts.done }} done</span
      >
      <span class="count"
        ><i class="dot paused" />{{ counts.paused }} idle</span
      >
    </p>
  </header>
</template>

<style scoped>
.fleet-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--hair);
  background: rgba(22, 24, 38, 0.6);
  backdrop-filter: blur(6px);
}
.modes {
  display: flex;
  gap: 4px;
}

/* The way back up, and the name of where you are standing. */
.crumb {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 9px 4px 5px;
  border: 0;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  font: 500 11.5px var(--font-ui);
  cursor: pointer;
}
.crumb:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}
.crumb-here {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-1);
  font: 600 11.5px var(--font-ui);
}
.mode-btn {
  appearance: none;
  padding: 4px 11px;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  font: 500 11.5px var(--font-ui);
  cursor: pointer;
}
.mode-btn:hover {
  color: var(--ink-1);
}
.mode-btn.on {
  border-color: var(--gold);
  background: var(--gold-soft);
  color: var(--ink-1);
}

.counts {
  display: flex;
  gap: 16px;
  margin: 0 0 0 auto;
  color: var(--ink-2);
  font: 400 11.5px var(--font-ui);
}
.count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
/* The scene's own palette (constellation-scene.ts COL) — the chip and the dot
   it counts must be the same colour. */
.dot.problem {
  background: #ef4444;
}
.dot.building {
  background: #b5abfc;
}
.dot.waiting {
  background: #ff9a3d;
}
.dot.done {
  background: #4ade80;
}
.dot.paused {
  background: var(--ink-3);
}
</style>
