<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useVoiceSession } from "../composables/voice/use-voice-session.js";
import { useVoiceDaemonLink } from "../composables/voice/use-voice-daemon-link.js";
import {
  voiceStageCaption,
  voiceStageOrbState,
} from "../components/voice/voice-stage-view.js";
import VoiceStage from "../components/voice/VoiceStage.vue";

// The floating Jarvis window — this view fills a small chromeless Chrome
// app-window (`chrome --app=/jarvis`) that the DAEMON launches and focuses on
// wake. Same composables as the in-app overlay; the whole window is the stage.
// It identifies itself as the 'jarvis' surface so the daemon prefers it for
// wake delivery over any regular app tabs.

// The daemon focuses this window by title (AppActivate) — keep them in sync
// with apps/voice `jarvis-window.ts`.
const WINDOW_TITLE = "Vynel Jarvis";

const isMuted = ref(false);

const voice = useVoiceSession({ onEnded: handleSessionEnded });
const daemon = useVoiceDaemonLink({ surface: "jarvis", onWake: handleWake });

function handleSessionEnded(): void {
  daemon.notifySessionEnd();
  // Put the window away once the conversation settles — unless the user muted
  // it or there's a failure to read. Chrome may refuse the close (it only
  // allows it while our history is a single entry); then we just stay idle,
  // and the next wake reuses this window instantly.
  if (!isMuted.value && !voice.failure.value) window.close();
}

function handleWake(command: string): void {
  isMuted.value = false;
  if (!voice.isActive.value) voice.start(command || undefined);
}

function toggleMute(): void {
  isMuted.value = !isMuted.value;
  if (isMuted.value) voice.end();
  else voice.start();
}

function close(): void {
  if (voice.isActive.value) voice.end(); // its onEnded closes the window
  else window.close();
}

onMounted(() => {
  document.title = WINDOW_TITLE;
  // Chrome ignores --window-size when it's already running, and app windows
  // remember their last size — so the window sizes itself (app windows may
  // self-resize; a normal tab would ignore this) and parks bottom-right.
  window.resizeTo(420, 560);
  window.moveTo(window.screen.availWidth - 440, window.screen.availHeight - 580);
});

const orbState = computed(() =>
  voiceStageOrbState(voice.view.value, isMuted.value),
);
const caption = computed(() =>
  voiceStageCaption(voice.view.value, isMuted.value, voice.failure.value),
);
const statusLine = computed(() =>
  daemon.isDaemonConnected.value
    ? "Wake word active — “Hey Vynel”"
    : "Wake daemon offline",
);
</script>

<template>
  <div class="jarvis-window">
    <VoiceStage
      :orb-state="orbState"
      :caption="caption"
      :status-line="statusLine"
      :is-muted="isMuted"
      @toggle-mute="toggleMute"
      @close="close"
    />
  </div>
</template>

<style scoped>
.jarvis-window {
  height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg-shell);
}
</style>
