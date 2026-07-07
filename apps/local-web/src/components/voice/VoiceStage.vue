<script setup lang="ts">
import { Mic, MicOff, X } from "lucide-vue-next";
import { IconButton, VoiceOrb } from "@vynel/ui";
import type { VoiceOrbState } from "@vynel/ui";

// The Jarvis stage — orb, caption, status line, mute/close. Pure presentation,
// shared by the in-app VoiceOverlay and the floating /jarvis window; each
// owner supplies the state and handles the controls.
defineProps<{
  orbState: VoiceOrbState;
  caption: string;
  statusLine: string;
  isMuted: boolean;
}>();

defineEmits<{
  toggleMute: [];
  close: [];
}>();
</script>

<template>
  <div class="stage" role="dialog" aria-label="Vynel voice">
    <VoiceOrb :state="orbState" :size="180" />
    <p class="caption">{{ caption }}</p>
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

.caption {
  margin: 6px 0 0;
  max-width: 46ch;
  text-align: center;
  color: var(--ink-1);
  font: 500 14px/1.6 var(--font-ui);
  min-height: 44px;
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
</style>
