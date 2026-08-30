<script setup lang="ts">
import type { SceneNode } from "../../utils/constellation-scene.js";
import { SCENE_STATUS_LABEL } from "../../composables/nodes/node-status.js";

// Everything on one track toward done.
//
// The lane's WORDS are the shared ladder label, not a track position: this
// reading kept a two-state "working / waiting to start" that the one-rule pass
// fixed in the other two, so a failed project read as "waiting to start" beside
// its own red dot (2026-08-19 audit, agent-4 §5a).
//
// The POSITION is the ladder too. Nothing reports a real fraction yet, so the
// track shows how far along the ladder a project is rather than inventing a
// percentage: idle at the line, waiting a third in, working past halfway,
// stalled where it stopped, done at the tape. The runner keeps its eased
// `left` transition, so it glides the day real fractions arrive.
const TRACK_POSITION: Record<SceneNode["status"], number> = {
  idle: 0,
  waiting: 34,
  building: 62,
  problem: 62,
  done: 100,
};

defineProps<{ nodes: readonly SceneNode[] }>();
</script>

<template>
  <div class="race-wrap">
    <div class="race">
      <div v-for="node in nodes" :key="node.id" class="lane" :class="node.status">
        <span class="lane-name">{{ node.name }}</span>
        <span class="track">
          <span class="fill" :style="{ width: `${TRACK_POSITION[node.status]}%` }" />
          <span
            class="runner"
            :class="node.status"
            :style="{ left: `${TRACK_POSITION[node.status]}%` }"
            >{{ node.initials }}</span
          >
        </span>
        <span class="lane-state">{{ SCENE_STATUS_LABEL[node.status] }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Centred, and wearing the room's palette — a hairline track pinned to the top
   of an empty sky was invisible on camera (Chad, 2026-08-29). Every colour
   falls back to the semantic token, so the untinted screen is unchanged. */
.race-wrap {
  position: absolute;
  inset: 46px 0 0;
  overflow-y: auto;
  display: grid;
  /* ONE track of the real width. `place-content: center` alone sized the
     track to its content, so the inner max-width resolved against nothing
     and eleven cards came out in a single column down the middle. `safe`
     keeps a list taller than the screen from being clipped at the top. */
  grid-template-columns: min(980px, 100%);
  justify-content: center;
  align-content: safe center;
  padding: 28px;
}
.race {
  display: grid;
  gap: 26px;
}
.lane {
  display: grid;
  grid-template-columns: 170px 1fr 150px;
  align-items: center;
  /* Wider than the runner is: at the tape it hangs half its width past the
     end of the track, straight through “ALL DONE”. */
  gap: 34px;
}
.lane-name {
  color: var(--display-text, var(--ink-1));
  font: 600 15px var(--display-font, var(--font-ui));
  letter-spacing: var(--display-tracking, 0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: var(--display-accent-faint, var(--hair-strong));
}
/* How far along, painted rather than implied: an empty rail read the same at
   every state. */
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    transparent,
    var(--display-accent, var(--gold))
  );
  transition: width 600ms var(--ease-out);
}
.runner {
  position: absolute;
  top: 50%;
  width: 40px;
  height: 40px;
  margin-left: -20px;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 2px solid var(--display-accent-dim, var(--ink-3));
  background: var(--display-panel-bg, var(--bg-raised));
  color: var(--display-text, var(--ink-1));
  font: 700 13px var(--display-font, var(--font-ui));
  transition: left 600ms var(--ease-out);
}
.runner.building {
  border-color: var(--display-accent, var(--gold));
  box-shadow: 0 0 24px var(--display-glow, var(--gold-soft));
}
.runner.problem {
  border-color: var(--display-attention, var(--danger, #ff6b6b));
}
.runner.done {
  border-color: var(--display-accent, var(--gold));
}
.lane-state {
  color: var(--display-accent-dim, var(--ink-3));
  font: 400 12px var(--display-font, var(--font-ui));
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.lane.problem .lane-state {
  color: var(--display-attention, var(--danger, #ff6b6b));
}
</style>
