<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { PresenceDot, formatElapsed } from "@vynel/ui";

// One in-flight session on the Home dashboard: who is working (persona ·
// workspace), what they're doing right now (narration line, crossfading as
// steps arrive), and for how long. Wears the gold breathing edge — the
// presence contract: if it glows gold, the assistant is alive there.
const props = defineProps<{
  label: string;
  /** "via Telegram" / "from a schedule" — null for a plain app turn. */
  originNote: string | null;
  startedAt: string;
  /** The current step in plain words — null before the first step arrives. */
  narration: string | null;
}>();

const emit = defineEmits<{ open: [] }>();

// Steps can settle in sub-second bursts — a flickering line reads as nervous.
// Coalesce: display swaps at most ~1×/800ms, always ending on the latest.
const COALESCE_MS = 800;
const displayedNarration = ref(props.narration);
let lastSwapAtMs = 0;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => props.narration,
  (next) => {
    if (coalesceTimer !== null) clearTimeout(coalesceTimer);
    const dueInMs = lastSwapAtMs + COALESCE_MS - Date.now();
    if (dueInMs <= 0) {
      displayedNarration.value = next;
      lastSwapAtMs = Date.now();
      return;
    }
    coalesceTimer = setTimeout(() => {
      displayedNarration.value = props.narration;
      lastSwapAtMs = Date.now();
    }, dueInMs);
  },
);

// Elapsed ticks once a second while the card lives (a card only exists while
// its turn runs, so the interval's lifetime is the card's).
const nowMs = ref(Date.now());
const elapsedTimer = setInterval(() => {
  nowMs.value = Date.now();
}, 1000);
onScopeDispose(() => {
  clearInterval(elapsedTimer);
  if (coalesceTimer !== null) clearTimeout(coalesceTimer);
});
const elapsedLabel = computed(() =>
  formatElapsed(new Date(props.startedAt).getTime(), nowMs.value),
);
</script>

<template>
  <button type="button" class="live-session-card" @click="emit('open')">
    <span class="card-top">
      <PresenceDot state="live" />
      <span class="card-label">{{ props.label }}</span>
      <span v-if="props.originNote" class="origin-note">{{
        props.originNote
      }}</span>
      <span class="elapsed">{{ elapsedLabel }}</span>
    </span>
    <Transition name="narration" mode="out-in">
      <span :key="displayedNarration ?? 'thinking'" class="narration">
        {{ displayedNarration ?? "thinking…" }}
      </span>
    </Transition>
  </button>
</template>

<style scoped>
.live-session-card {
  appearance: none;
  margin: 0;
  text-align: left;
  cursor: default;
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  min-width: 240px;
  background: var(--bg-panel);
  border: 1px solid var(--gold-soft);
  border-radius: var(--radius-m);
  animation: card-breathe 2.4s ease-in-out infinite;
}

.live-session-card:hover {
  background: var(--row-hover);
}

.live-session-card:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.card-label {
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.origin-note {
  flex: none;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
}

.elapsed {
  flex: none;
  margin-left: auto;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
}

.narration {
  color: var(--ink-2);
  font: 400 12px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.narration-enter-active,
.narration-leave-active {
  transition:
    opacity 0.12s var(--ease-out, ease-out),
    transform 0.12s var(--ease-out, ease-out);
}

.narration-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.narration-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes card-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
  50% {
    box-shadow: 0 0 14px 0 var(--gold-soft);
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-session-card {
    animation: none;
  }

  .narration-enter-active,
  .narration-leave-active {
    transition: none;
  }
}
</style>
