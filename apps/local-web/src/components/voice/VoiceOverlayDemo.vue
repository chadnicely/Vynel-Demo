<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { Mic, MicOff, X } from "lucide-vue-next";
import { IconButton, VoiceOrb } from "@vynel/ui";
import type { VoiceOrbState } from "@vynel/ui";
import { useUiStore } from "../../stores/ui-store.js";

// Jarvis, demo edition: a scripted animation loop through the real state
// vocabulary (wake → listening → thinking → speaking). No microphone, no
// engine — the voice-engine module + Tauri overlay window drive the same
// VoiceOrb with real events later.
interface VoiceDemoBeat {
  state: VoiceOrbState;
  caption: string;
  holdMs: number;
}

const DEMO_LOOP: VoiceDemoBeat[] = [
  { state: "idle", caption: "Say “Hey Vynel” to wake it", holdMs: 2200 },
  { state: "wake", caption: "Hey Vynel…", holdMs: 700 },
  {
    state: "listening",
    caption: "Listening — “what's on my plate today?”",
    holdMs: 2600,
  },
  {
    state: "thinking",
    caption: "Checking your schedules and approvals…",
    holdMs: 2200,
  },
  {
    state: "speaking",
    caption:
      "“Two things: the morning briefing is ready, and one approval is waiting.”",
    holdMs: 3600,
  },
  { state: "listening", caption: "Listening…", holdMs: 2000 },
];

const ui = useUiStore();

const beatIndex = ref(0);
const isMuted = ref(false);
let beatTimer: ReturnType<typeof setTimeout> | null = null;

const currentBeat = computed(
  () => DEMO_LOOP[beatIndex.value % DEMO_LOOP.length]!,
);
const orbState = computed<VoiceOrbState>(() =>
  isMuted.value ? "muted" : currentBeat.value.state,
);
const caption = computed(() =>
  isMuted.value ? "Muted — Vynel isn't listening" : currentBeat.value.caption,
);

function scheduleNextBeat() {
  if (beatTimer) clearTimeout(beatTimer);
  beatTimer = setTimeout(() => {
    beatIndex.value = (beatIndex.value + 1) % DEMO_LOOP.length;
    scheduleNextBeat();
  }, currentBeat.value.holdMs);
}

watch(
  () => [ui.isVoiceOverlayOpen, isMuted.value] as const,
  ([isOpen, muted]) => {
    if (beatTimer) clearTimeout(beatTimer);
    if (isOpen && !muted) scheduleNextBeat();
  },
  { immediate: true },
);

onUnmounted(() => {
  if (beatTimer) clearTimeout(beatTimer);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="voice-overlay">
      <div v-if="ui.isVoiceOverlayOpen" class="voice-layer">
        <div class="scrim" @click="ui.isVoiceOverlayOpen = false" />

        <div class="stage" role="dialog" aria-label="Vynel voice">
          <VoiceOrb :state="orbState" :size="180" />
          <p class="caption">{{ caption }}</p>
          <p class="demo-note">Voice demo — the engine plugs in later</p>

          <div class="controls">
            <IconButton
              :label="isMuted ? 'Unmute listening' : 'Mute listening'"
              :active="isMuted"
              @click="isMuted = !isMuted"
            >
              <MicOff v-if="isMuted" :size="16" />
              <Mic v-else :size="16" />
            </IconButton>
            <IconButton
              label="Close voice"
              @click="ui.isVoiceOverlayOpen = false"
            >
              <X :size="16" />
            </IconButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.voice-layer {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
}

.scrim {
  position: absolute;
  inset: 0;
  background: var(--bg-overlay);
  backdrop-filter: blur(10px);
}

.stage {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 24px;
}

.caption {
  margin: 6px 0 0;
  max-width: 46ch;
  text-align: center;
  color: var(--ink-1);
  font: 500 14px/1.6 var(--font-ui);
  min-height: 44px;
}

.demo-note {
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

.voice-overlay-enter-active,
.voice-overlay-leave-active {
  transition: opacity var(--t-slow) var(--ease-out);
}

.voice-overlay-enter-from,
.voice-overlay-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .voice-overlay-enter-active,
  .voice-overlay-leave-active {
    transition: none;
  }
}
</style>
