<script setup lang="ts">
import LiveSessionCard from "./LiveSessionCard.vue";

// "Right now" — the Home dashboard's live band: one card per in-flight turn,
// present only while work runs (the host v-ifs the band away when idle, so an
// empty shell never sits on the calm screen).
export interface LiveTurnRow {
  turnId: string;
  workspaceId: string | null;
  label: string;
  originNote: string | null;
  startedAt: string;
  narration: string | null;
}

defineProps<{ turns: LiveTurnRow[] }>();

const emit = defineEmits<{
  open: [workspaceId: string | null];
  /** The full roster — the Background overview (B7). */
  seeAll: [];
}>();
</script>

<template>
  <section class="live-now-band" aria-label="Right now">
    <p class="band-title">
      Right now
      <button
        type="button"
        class="see-all"
        data-testid="live-band-see-all"
        @click="emit('seeAll')"
      >
        See all
      </button>
    </p>
    <TransitionGroup name="live-card" tag="div" class="card-rail">
      <LiveSessionCard
        v-for="turn in turns"
        :key="turn.turnId"
        :label="turn.label"
        :origin-note="turn.originNote"
        :started-at="turn.startedAt"
        :narration="turn.narration"
        @open="emit('open', turn.workspaceId)"
      />
    </TransitionGroup>
  </section>
</template>

<style scoped>
.live-now-band {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.band-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink-2);
  font: 600 11px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.see-all {
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.see-all:hover {
  color: var(--ink-1);
}

.card-rail {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.live-card-enter-active {
  transition:
    opacity 0.24s var(--ease-out, ease-out),
    transform 0.24s var(--ease-out, ease-out);
}

.live-card-leave-active {
  transition: opacity 0.2s var(--ease-out, ease-out);
}

.live-card-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.live-card-leave-to {
  opacity: 0;
}

.live-card-move {
  transition: transform 0.24s var(--ease-out, ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .live-card-enter-active,
  .live-card-leave-active,
  .live-card-move {
    transition: none;
  }
}
</style>
