<script setup lang="ts">
import type { SceneNode } from "../../utils/constellation-scene.js";
import { SCENE_STATUS_LABEL } from "../../composables/nodes/node-status.js";

// The same level as cards, for reading rather than watching.
//
// It wears the ROOM's palette (Chad, 2026-08-29): themed, this screen is the
// Display in another form, and grey app cards on a violet sky read as a
// different program. Every colour below falls back to the semantic token, so
// the untinted screen is exactly what it was.
defineProps<{ nodes: readonly SceneNode[] }>();
const emit = defineEmits<{ open: [nodeId: string] }>();
</script>

<template>
  <div class="grid-wrap">
    <div class="grid">
      <button
        v-for="node in nodes"
        :key="node.id"
        type="button"
        class="card"
        :class="node.status"
        @click="emit('open', node.id)"
      >
        <span class="card-face">{{ node.initials }}</span>
        <span class="card-body">
          <span class="card-name">{{ node.name }}</span>
          <span class="card-state">
            <i class="dot" />
            {{ SCENE_STATUS_LABEL[node.status] }}
          </span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* The cards sit in the middle of the room rather than in its top-left corner:
   on camera a single card pinned to a corner of an empty sky read as a screen
   that had failed to load (Chad, 2026-08-29). */
.grid-wrap {
  position: absolute;
  inset: 46px 0 0;
  overflow-y: auto;
  display: grid;
  /* ONE track of the real width. `place-content: center` alone sized the
     track to its content, so the inner max-width resolved against nothing
     and eleven cards came out in a single column down the middle. `safe`
     keeps a list taller than the screen from being clipped at the top. */
  grid-template-columns: min(1120px, 100%);
  justify-content: center;
  align-content: safe center;
  padding: 28px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(268px, 1fr));
  gap: 14px;
}
.card {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--display-accent-faint, var(--hair));
  border-radius: var(--display-panel-radius, var(--radius-m));
  background: var(--display-panel-bg, var(--bg-raised));
  backdrop-filter: blur(7px) saturate(1.15);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}
.card:hover {
  border-color: var(--display-accent-dim, var(--hair-strong));
  transform: translateY(-2px);
}
.card.building {
  border-color: var(--display-accent, var(--gold));
}
.card-face {
  flex: none;
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 2px solid var(--display-accent-dim, var(--ink-3));
  color: var(--display-text, var(--ink-1));
  font: 700 14px var(--display-font, var(--font-ui));
  letter-spacing: var(--display-tracking, 0);
}
.card.building .card-face {
  border-color: var(--display-accent, var(--gold));
  box-shadow: 0 0 22px var(--display-glow, var(--gold-soft));
}
.card-body {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.card-name {
  color: var(--display-text, var(--ink-1));
  font: 600 16px var(--display-font, var(--font-ui));
  letter-spacing: var(--display-tracking, 0);
}
.card-state {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--display-accent-dim, var(--ink-3));
  font: 400 12.5px var(--display-font, var(--font-ui));
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
/* Working is the one state that moves — the eye should land on it first. */
.card.building .dot {
  background: var(--display-accent, var(--gold));
  box-shadow: 0 0 10px var(--display-glow, var(--gold-soft));
  animation: card-pulse 1.6s ease-in-out infinite;
}
.card.problem .card-state {
  color: var(--display-attention, var(--danger, #ff6b6b));
}

@keyframes card-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card.building .dot {
    animation: none;
  }
}
</style>
