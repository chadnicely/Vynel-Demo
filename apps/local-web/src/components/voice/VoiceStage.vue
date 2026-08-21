<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PhMicrophone as Mic, PhMicrophoneSlash as MicOff, PhX as X } from "@phosphor-icons/vue";
import { IconButton, VoiceOrb } from "@vynel/ui";
import type { VoiceOrbState } from "@vynel/ui";

// The voice stage — orb, caption, status line, mute/close. Pure presentation,
// shared by the in-app VoiceOverlay and the /display-dock window; each
// owner supplies the state and handles the controls. The orb has one state,
// but the session listens THROUGH its reply (voice-realtime VR2): while it
// thinks or speaks with the mic open, a listening ring + hint say so.
const props = defineProps<{
  orbState: VoiceOrbState;
  caption: string;
  statusLine: string;
  isMuted: boolean;
  /** The mic is open (every live phase, unless muted). */
  isListening: boolean;
}>();

defineEmits<{
  toggleMute: [];
  close: [];
}>();

const isListeningWhileBusy = computed(
  () => props.isListening && (props.orbState === "thinking" || props.orbState === "speaking"),
);

// The caption is the reply growing a sentence at a time — keep its newest
// words in view once it outgrows its box.
const captionEl = ref<HTMLParagraphElement | null>(null);
watch(
  () => props.caption,
  () => {
    const el = captionEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
  { flush: "post" },
);
</script>

<template>
  <div class="stage" role="dialog" aria-label="Vynel voice">
    <div class="orb-slot" :class="{ 'is-also-listening': isListeningWhileBusy }">
      <span v-if="isListeningWhileBusy" class="listen-ring" aria-hidden="true" />
      <VoiceOrb :state="orbState" :size="180" />
    </div>
    <p ref="captionEl" class="caption">{{ caption }}</p>
    <p v-if="isListeningWhileBusy" class="listen-hint" data-testid="voice-listen-hint">
      Listening — just talk to interrupt
    </p>
    <p class="status-line">{{ statusLine }}</p>

    <div class="controls">
      <IconButton
        :label="isMuted ? 'Unmute listening' : 'Mute listening'"
        :active="isMuted"
        @click="$emit('toggleMute')"
      >
        <MicOff v-if="isMuted" :size="16" />
        <Mic v-else :size="16" />
      </IconButton>
      <IconButton label="Close voice" @click="$emit('close')">
        <X :size="16" />
      </IconButton>
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 24px;
}

.orb-slot {
  position: relative;
  display: grid;
  place-items: center;
}

/* The open mic beside a thinking/speaking orb — a slow attentive ring. */
.listen-ring {
  position: absolute;
  inset: -10px;
  border-radius: 50%;
  border: 1.5px solid var(--gold-soft);
  animation: listen-ring-pulse 1.8s var(--ease-out) infinite;
}

@keyframes listen-ring-pulse {
  0% {
    transform: scale(0.96);
    opacity: 0.7;
  }
  100% {
    transform: scale(1.06);
    opacity: 0;
  }
}

.caption {
  margin: 6px 0 0;
  max-width: 46ch;
  max-height: 9.6em;
  overflow-y: auto;
  text-align: center;
  color: var(--ink-1);
  font: 500 14px/1.6 var(--font-ui);
  min-height: 44px;
}

.listen-hint {
  margin: -6px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.status-line {
  margin: 0;
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.controls {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .listen-ring {
    animation: none;
    opacity: 0.5;
  }
}
</style>
