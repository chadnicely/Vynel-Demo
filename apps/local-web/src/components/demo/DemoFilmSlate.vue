<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

// The film slate (Chad, 2026-08-29): clip ID → 3-second countdown → BLACK.
//
// The ID is the clip's identity — the same number stamped on the take's card —
// so the footage this camera is about to record can be matched to its take
// later. It wears a SLATE look (boxed, labelled, accent) so it can never be
// mistaken for the countdown that follows it (Chad, same day: "make the ID
// look different than the countdown"). Then the screen goes black and STAYS
// black: the take begins when Chad speaks, and the parent removes this overlay
// the moment that happens. The slate never times itself out — black is the
// waiting state, not a phase.

const props = defineProps<{
  clipNumber: number;
}>();

const emit = defineEmits<{
  /** The countdown finished — the screen is black and the take may be armed. */
  black: [];
}>();

const NUMBER_HOLD_MS = 2000;
const COUNT_STEP_MS = 1000;

type SlatePhase = "id" | "count" | "black";
const phase = ref<SlatePhase>("id");
const digit = ref("3");
let timers: ReturnType<typeof setTimeout>[] = [];

onMounted(() => {
  const at = (ms: number, run: () => void) => timers.push(setTimeout(run, ms));
  at(NUMBER_HOLD_MS, () => (phase.value = "count"));
  at(NUMBER_HOLD_MS + COUNT_STEP_MS, () => (digit.value = "2"));
  at(NUMBER_HOLD_MS + COUNT_STEP_MS * 2, () => (digit.value = "1"));
  at(NUMBER_HOLD_MS + COUNT_STEP_MS * 3, () => {
    phase.value = "black";
    emit("black");
  });
});

onBeforeUnmount(() => timers.forEach(clearTimeout));
</script>

<template>
  <div class="film-slate" data-testid="film-slate">
    <!-- The ID: a production slate, not a number flashing by. -->
    <div v-if="phase === 'id'" class="clip-card">
      <span class="clip-word">CLIP</span>
      <span class="clip-value">{{ clipNumber }}</span>
    </div>

    <!-- The countdown: bare digits, nothing else on screen. -->
    <span v-else-if="phase === 'count'" :key="digit" class="digit">
      {{ digit }}
    </span>
  </div>
</template>

<style scoped>
.film-slate {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: #000;
}

.clip-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 36px 72px;
  border: 3px solid var(--color-accent, #8b7bff);
  border-radius: 10px;
}

.clip-word {
  color: var(--color-accent, #8b7bff);
  font-size: clamp(18px, 3vw, 34px);
  font-weight: 700;
  letter-spacing: 0.6em;
  /* The tracking pads the right edge; nudge back to optical centre. */
  margin-right: -0.6em;
}

.clip-value {
  color: #fff;
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: clamp(80px, 16vw, 220px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.digit {
  color: #fff;
  font-size: clamp(96px, 22vw, 320px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  animation: slate-pop 0.9s ease-out;
}

@keyframes slate-pop {
  0% {
    opacity: 0.2;
    transform: scale(1.25);
  }
  30% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
