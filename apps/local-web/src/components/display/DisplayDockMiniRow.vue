<script setup lang="ts">
import { DisplayOrb } from "@vynel/ui";
import { ref } from "vue";
import type { DisplayDockCard } from "../../composables/display/display-dock-cards.js";

// The mini dock: the Display's room squeezed into one row over the corner of
// someone else's screen — a small orb, the last thing said, the mic, and
// whatever Claude put in the `dock` slot. Pure presentation, the way
// `VoiceStage` is for the wake shape: `DisplayDockView` owns the session and
// hands both shapes their state.
//
// It carries `.display-root` itself (the Display's ground and palette) so it
// reads as the same surface as the room, at a tenth of the size.
defineProps<{
  /** The orb's three dials, from the room's own derivation. */
  orb: { energy: number; listening: boolean; speaking: boolean };
  /** Bumps once per spoken clause. */
  spikeKey: number;
  caption: string;
  cards: ReadonlyArray<DisplayDockCard>;
  /** "Listening" · "Muted" · "Resume". */
  micLabel: string;
  isListening: boolean;
}>();

defineEmits<{ toggleMute: [] }>();

// A machine without canvas 2D loses the orb, not the row.
const hasOrb = ref(true);
</script>

<template>
  <div class="display-root mini-row" data-testid="display-dock-mini" data-tauri-drag-region>
    <DisplayOrb
      v-if="hasOrb"
      class="mini-orb"
      :energy="orb.energy"
      :listening="orb.listening"
      :speaking="orb.speaking"
      :spike-key="spikeKey"
      @renderer-failed="hasOrb = false"
    />
    <div class="mini-body">
      <p class="mini-caption" data-testid="display-dock-caption">{{ caption }}</p>
      <div class="mini-cards" data-testid="display-dock-cards">
        <span
          v-for="card in cards"
          :key="card.id"
          class="dock-card"
          :class="`is-${card.shape}`"
        >
          <template v-if="card.shape === 'metric'">
            <b class="card-value">{{ card.value }}</b>
            <span class="card-label">{{ card.label }}</span>
          </template>
          <template v-else-if="card.shape === 'line'">{{ card.text }}</template>
          <template v-else>{{ card.title }}</template>
        </span>
      </div>
    </div>
    <button
      type="button"
      class="mini-mic"
      :class="{ on: isListening }"
      :aria-pressed="isListening"
      data-testid="display-dock-mic"
      @click="$emit('toggleMute')"
    >
      {{ micLabel }}
    </button>
  </div>
</template>

<style scoped>
.mini-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
}

.mini-orb {
  flex: none;
  width: 56px;
  height: 56px;
}

.mini-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* The last thing said, one line of it: the room carries the whole reply. */
.mini-caption {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.45;
  color: var(--display-text, #cdf3ff);
}

.mini-cards {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.dock-card {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  flex: none;
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 7px;
  border: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  font-size: 10px;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

.card-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--display-text, #cdf3ff);
}

.card-label {
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.mini-mic {
  flex: none;
  align-self: center;
  padding: 3px 9px;
  border: 1px solid var(--display-accent-faint, rgba(79, 216, 255, 0.16));
  background: transparent;
  font: inherit;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
  cursor: pointer;
}

.mini-mic.on {
  border-color: var(--display-accent, #4fd8ff);
  color: var(--display-text, #cdf3ff);
}
</style>
