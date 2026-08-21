<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useUiStore } from "../../stores/ui-store.js";
import { useVoiceSession } from "../../composables/voice/use-voice-session.js";
import { useVoiceDaemonLink } from "../../composables/voice/use-voice-daemon-link.js";
import {
  voiceStageCaption,
  voiceStageIsListening,
  voiceStageOrbState,
} from "./voice-stage-view.js";
import VoiceStage from "./VoiceStage.vue";

// The in-app voice view: the daemon hears "Hey Vynel" locally and hands the
// session here — Web Speech (Google STT) transcribes commands with a live
// interim caption, the brain answers over /root/turn on the spoken thread, and
// the reply's streamed text is spoken in the browser a sentence at a time while
// the mic stays open (talk over it to interrupt). Also opens from the mic
// button with no daemon. Closing it by any route ends the session — which
// stops a running turn by its own session id (round-2 R2-E), never the global
// head. (The floating desktop variant of this surface is views/DisplayDockView.vue.)

// The daemon wants the Display in front of the user (a wake is landing in the
// display dock). This overlay holds the window's ONLY `voice:app` link while
// the room is closed — which is exactly when there is something to open — so
// the event arrives here and the shell, which owns the switch, acts on it.
// (While the room IS open, DisplayView holds the link and there is nothing to
// do.) A second link in the shell would double-play every relayed line.
const emit = defineEmits<{ showDisplay: [] }>();

const ui = useUiStore();
const isMuted = ref(false);

// Hoisted handlers so the two composables can reference each other's owners —
// both callbacks only ever fire after setup completes.
const voice = useVoiceSession({ onEnded: handleSessionEnded });
const daemon = useVoiceDaemonLink({
  onWake: handleWake,
  ownLiveSessionId: voice.currentSessionId,
  speakThroughSession: voice.speakExternal,
  onShowDisplay: () => emit("showDisplay"),
});

// The session settled (idle silence, close, or a start that couldn't begin):
// give the mic back to the daemon, and put the overlay away — unless the user
// muted it or there's a failure they need to read (mic denied, no Web Speech).
function handleSessionEnded(): void {
  daemon.notifySessionEnd();
  if (!isMuted.value && !voice.failure.value) ui.isVoiceOverlayOpen = false;
}

function handleWake(command: string, turnWatchdogMs?: number): void {
  isMuted.value = false;
  ui.isVoiceOverlayOpen = true;
  if (!voice.isActive.value) voice.start(command || undefined, turnWatchdogMs);
}

// The manual path: mic button opens the overlay → start listening; closing it
// by any route ends the session.
watch(
  () => ui.isVoiceOverlayOpen,
  (isOpen) => {
    if (isOpen) {
      if (!voice.isActive.value && !isMuted.value) voice.start();
    } else {
      isMuted.value = false;
      voice.end();
    }
  },
);

function toggleMute() {
  isMuted.value = !isMuted.value;
  if (isMuted.value) voice.end();
  else voice.start();
}

const orbState = computed(() => voiceStageOrbState(voice.view.value, isMuted.value));
const isListening = computed(() => voiceStageIsListening(voice.view.value, isMuted.value));
const caption = computed(() =>
  voiceStageCaption(voice.view.value, isMuted.value, voice.failure.value),
);

const wakeStatus = computed(() =>
  daemon.isDaemonConnected.value
    ? "Wake word active — “Hey Claude”"
    : "Wake daemon offline — mic button only",
);
</script>

<template>
  <Teleport to="body">
    <Transition name="voice-overlay">
      <div v-if="ui.isVoiceOverlayOpen" class="voice-layer">
        <div class="scrim" @click="ui.isVoiceOverlayOpen = false" />
        <VoiceStage
          :orb-state="orbState"
          :caption="caption"
          :status-line="wakeStatus"
          :is-muted="isMuted"
          :is-listening="isListening"
          @toggle-mute="toggleMute"
          @close="ui.isVoiceOverlayOpen = false"
        />
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
