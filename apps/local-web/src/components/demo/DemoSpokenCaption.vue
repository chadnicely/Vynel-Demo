<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";

// The sentence being said, typed out under the orb in time with the voice
// (Chad, 2026-08-29). Viewers read faster than anyone speaks, so a whole
// sentence dumped on screen is read and abandoned before the line is half
// spoken; typed across the recording's own length, the eye stays with the ear.
//
// It types by WORD rather than by letter: letter-by-letter reads as a terminal
// effect, word-by-word reads as someone talking.
const props = defineProps<{ text: string; durationMs: number }>();

const shown = ref("");
let frame = 0;

const stop = () => {
  if (frame !== 0) cancelAnimationFrame(frame);
  frame = 0;
};

function type(): void {
  stop();
  const words = props.text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    shown.value = "";
    return;
  }
  const still =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still || typeof requestAnimationFrame !== "function") {
    shown.value = props.text;
    return;
  }
  // Land the last word a beat BEFORE the audio ends, so the caption is never
  // still catching up when the room cuts to the next line.
  // The first word is painted NOW rather than on the first animation frame:
  // mounted blank, the caption flickered in a frame late, which on camera is
  // a hole under the orb at the exact moment the voice starts.
  shown.value = words[0] ?? "";
  const span = Math.max(400, props.durationMs * 0.88);
  const startedAt = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / span);
    const upTo = Math.max(1, Math.ceil(words.length * progress));
    shown.value = words.slice(0, upTo).join(" ");
    if (progress < 1) frame = requestAnimationFrame(tick);
    else frame = 0;
  };
  frame = requestAnimationFrame(tick);
}

watch(() => [props.text, props.durationMs], type, { immediate: true });
onBeforeUnmount(stop);
</script>

<template>
  <p class="spoken" data-testid="spoken-caption">{{ shown }}</p>
</template>

<style scoped>
.spoken {
  margin: 0;
  max-width: var(--caption-width, 26ch);
  text-align: center;
  text-wrap: balance;
  color: var(--display-text, #cdf3ff);
  font: 500 clamp(15px, 1.5vw, 20px) / 1.45 var(--display-font, ui-monospace, monospace);
  letter-spacing: var(--display-tracking, 0.04em);
  opacity: 0.92;
}
</style>
