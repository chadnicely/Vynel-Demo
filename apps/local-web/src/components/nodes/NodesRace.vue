<script setup lang="ts">
import type { SceneNode } from "../../utils/constellation-scene.js";

// Everything on one track toward done. Nothing reports progress until the
// engine lands, so a working project sits mid-track and the rest wait at the
// start; the lanes are honest about that. The runner keeps its eased `left`
// transition so it glides the day real fractions arrive.
defineProps<{ nodes: readonly SceneNode[] }>();
</script>

<template>
  <div class="race">
    <div v-for="node in nodes" :key="node.id" class="lane">
      <span class="lane-name">{{ node.name }}</span>
      <span class="track">
        <span
          class="runner"
          :class="node.status"
          :style="{ left: node.status === 'building' ? '50%' : '0%' }"
          >{{ node.initials }}</span
        >
      </span>
      <span class="lane-state">{{
        node.status === "building" ? "working" : "waiting to start"
      }}</span>
    </div>
  </div>
</template>

<style scoped>
.race {
  position: absolute;
  inset: 46px 0 0;
  overflow-y: auto;
  padding: 24px 26px;
  display: grid;
  gap: 18px;
  align-content: start;
}
.lane {
  display: grid;
  grid-template-columns: 140px 1fr 120px;
  align-items: center;
  gap: 14px;
}
.lane-name {
  color: var(--ink-1);
  font: 600 12.5px var(--font-ui);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track {
  position: relative;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--hair-strong), var(--gold-soft));
}
.runner {
  position: absolute;
  top: 50%;
  width: 30px;
  height: 30px;
  margin-left: -15px;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 2px solid var(--ink-3);
  background: var(--bg-raised);
  color: var(--ink-1);
  font: 700 11px var(--font-ui);
  transition: left 600ms var(--ease-out);
}
.runner.building {
  border-color: var(--gold);
  box-shadow: 0 0 20px var(--gold-soft);
}
.lane-state {
  color: var(--ink-3);
  font: 400 11px var(--font-ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>
