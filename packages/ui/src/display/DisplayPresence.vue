<script setup lang="ts">
import { computed } from "vue";
import DisplayOrb from "./DisplayOrb.vue";
import type { OrbPalette } from "./orb-palette.js";
import type { DisplayStageKind } from "./display-shapes.js";
import type { OrbForm } from "./orb-forms.js";

// The room's presence, whichever shape the theme asked for. The orb is one of
// three, not the base case with variations: a theme that shows a bar meter is
// not "the orb, restyled", and pretending otherwise is how a set of themes
// ends up looking like one.
//
// Only the orb needs canvas. The wave is CSS, driven by the same
// three inputs, which is why it still shows a presence on a machine that
// cannot give us a 2D context — and why it costs nothing when idle.
const props = defineProps<{
  kind: DisplayStageKind;
  /** How busy the assistant is, 0..1. */
  energy: number;
  /** The microphone is open. */
  listening: boolean;
  /** The assistant is talking. */
  speaking: boolean;
  /** Bump to throw one shockwave — the orb only. */
  spikeKey?: number | undefined;
  /** The theme's canvas paint set — the orb only. */
  palette?: OrbPalette | undefined;
  /** Which shape the canvas cloud takes — the orb only. */
  form?: OrbForm | undefined;
}>();

const emit = defineEmits<{
  (event: "renderer-failed", error: unknown): void;
}>();

// Energy drives amplitude everywhere, but a silent room should still look
// alive, so the floor is never zero.
const level = computed(
  () => 0.18 + Math.max(0, Math.min(1, props.energy)) * 0.82,
);

// The bar model. Deterministic on purpose: the wave has to look the same every
// mount, or a re-render reshuffles the whole meter.

const BAR_COUNT = 56;
const bars = computed(() =>
  Array.from({ length: BAR_COUNT }, (_, index) => {
    const across = index / (BAR_COUNT - 1);
    // Two out-of-phase sines rather than one: a single envelope gives a smooth
    // hill that reads as a decoration, while two beating against each other
    // give the ragged silhouette an actual level meter has.
    const shape =
      0.36 +
      Math.sin(across * Math.PI) * 0.44 +
      Math.sin(across * Math.PI * 7 + 1.2) * 0.13 +
      Math.sin(across * Math.PI * 13 + 0.4) * 0.07;
    return {
      key: index,
      // Deterministic, and deliberately NOT a multiple of the animation
      // period — neighbouring bars must never rise together in a visible wave.
      delay: `${-((index * 0.137) % 1.1).toFixed(3)}s`,
      duration: `${(0.62 + ((index * 0.31) % 1) * 0.5).toFixed(2)}s`,
      scale: Math.max(0.12, shape) * level.value,
    };
  }),
);
</script>

<template>
  <!-- The canvas orb: unchanged, and still the only one that can fail. -->
  <DisplayOrb
    v-if="props.kind === 'orb'"
    class="presence"
    :energy="props.energy"
    :listening="props.listening"
    :speaking="props.speaking"
    :spike-key="props.spikeKey"
    :palette="props.palette"
    :form="props.form"
    @renderer-failed="emit('renderer-failed', $event)"
  />

  <!-- Bars across the middle. -->
  <div
    v-else
    class="presence wave-stage"
    :class="{ listening: props.listening, speaking: props.speaking }"
    aria-hidden="true"
    data-testid="display-presence-wave"
  >
    <span
      v-for="bar in bars"
      :key="bar.key"
      class="bar"
      :style="{
        '--delay': bar.delay,
        '--scale': bar.scale,
        '--dur': bar.duration,
      }"
    />
  </div>
</template>

<style scoped>
.presence {
  flex: 1;
  width: 100%;
  min-height: 0;
  display: block;
}

/* --- wave ---------------------------------------------------------------- */
/* Mirrored around the centre line rather than standing on a floor: a meter
 * that grows both ways reads as a signal, one that grows upward reads as a bar
 * chart. Everything glows, because on a black room the object IS the light. */
.wave-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(2px, 0.4vw, 7px);
  padding: 0 5%;
  position: relative;
}

/* The zero line the signal sits on — thin, and lit its whole width. */
.wave-stage::before {
  content: "";
  position: absolute;
  left: 5%;
  right: 5%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--display-accent, #4fd8ff) 12%,
    var(--display-accent, #4fd8ff) 88%,
    transparent
  );
  opacity: 0.5;
  filter: drop-shadow(0 0 10px var(--display-glow, rgba(79, 216, 255, 0.7)));
}

.bar {
  flex: 1 1 0;
  max-width: 18px;
  /* Height is the FULL excursion; the bar is centred, so it opens equally
   * above and below the line. */
  height: calc(8% + var(--scale, 0.4) * 84%);
  /* Hard edges, not soft ones. The bar was fading to transparent at BOTH ends
   * and carrying a 12px halo, so nothing in it had a defined boundary — a
   * meter reads as crisp because its bars end somewhere. The gradient now runs
   * colour-to-colour with only the last 6% falling off, the radius is small
   * enough to be a cap rather than a lozenge, and the glow is tight. */
  border-radius: 2px;
  background: linear-gradient(
    180deg,
    var(--display-accent, #4fd8ff) 0%,
    var(--display-text, #cdf3ff) 50%,
    var(--display-accent, #4fd8ff) 100%
  );
  box-shadow: 0 0 5px var(--display-glow, rgba(79, 216, 255, 0.55));
  transform-origin: center;
  animation: presence-bar var(--dur, 1.1s) ease-in-out infinite alternate;
  animation-delay: var(--delay, 0s);
}

.wave-stage.speaking .bar {
  animation-duration: calc(var(--dur, 1.1s) * 0.45);
}

.wave-stage.listening .bar {
  animation-duration: calc(var(--dur, 1.1s) * 0.7);
}

.wave-stage:not(.listening):not(.speaking) .bar {
  animation-duration: calc(var(--dur, 1.1s) * 1.9);
  opacity: 0.8;
}

@keyframes presence-bar {
  from {
    transform: scaleY(0.14);
  }
  to {
    transform: scaleY(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bar {
    animation: none;
  }
}
</style>

<style src="./display-themes.css"></style>
