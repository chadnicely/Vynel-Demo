<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useVoiceSession } from "../composables/voice/use-voice-session.js";
import { useVoiceDaemonLink } from "../composables/voice/use-voice-daemon-link.js";
import { createOverlayWindowControls } from "../composables/voice/tauri-overlay-window.js";
import {
  voiceStageCaption,
  voiceStageIsListening,
  voiceStageOrbState,
} from "../components/voice/voice-stage-view.js";
import VoiceStage from "../components/voice/VoiceStage.vue";

// The floating Jarvis overlay — this view fills either the Tauri desktop
// shell's transparent always-on-top window (apps/desktop) or a chromeless
// Chrome app-window the daemon launches (`chrome --app=/jarvis`). Same
// composables as the in-app overlay; the whole window is the stage. It
// identifies itself as the 'jarvis' surface so the daemon prefers it for wake
// delivery over any regular app tabs. Closing it mid-reply ends the session,
// which stops the running turn by its own session id (round-2 R2-E) — never
// the global head.

// The daemon focuses the Chrome variant by title (AppActivate) — keep in sync
// with apps/voice `jarvis-window.ts`.
const WINDOW_TITLE = "Vynel Jarvis";

const overlayWindow = createOverlayWindowControls();
const isMuted = ref(false);

const voice = useVoiceSession({ onEnded: handleSessionEnded });
const daemon = useVoiceDaemonLink({
  surface: "jarvis",
  onWake: handleWake,
  isPlayingOwnTurn: () => voice.isActive.value,
});

function handleSessionEnded(): void {
  daemon.notifySessionEnd();
  // Put the window away once the conversation settles — unless the user muted
  // it or there's a failure to read; the next wake reveals it again.
  if (!isMuted.value && !voice.failure.value) overlayWindow.dismiss();
}

function handleWake(command: string): void {
  isMuted.value = false;
  overlayWindow.reveal();
  if (!voice.isActive.value) voice.start(command || undefined);
}

function toggleMute(): void {
  isMuted.value = !isMuted.value;
  if (isMuted.value) voice.end();
  else voice.start();
}

function close(): void {
  if (voice.isActive.value) voice.end(); // its onEnded dismisses the window
  else overlayWindow.dismiss();
}

onMounted(() => {
  document.title = WINDOW_TITLE;
  overlayWindow.parkCenter();
  if (overlayWindow.isTauri) {
    // The Tauri window is transparent — the page background must be too, so
    // only the rounded stage card is visible as the overlay.
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }
});

const orbState = computed(() =>
  voiceStageOrbState(voice.view.value, isMuted.value),
);
const isListening = computed(() =>
  voiceStageIsListening(voice.view.value, isMuted.value),
);
const caption = computed(() =>
  voiceStageCaption(voice.view.value, isMuted.value, voice.failure.value),
);
const statusLine = computed(() =>
  daemon.isDaemonConnected.value
    ? "Wake word active — “Hey Claude”"
    : "Wake daemon offline",
);
</script>

<template>
  <div class="jarvis-window" :class="{ 'is-tauri': overlayWindow.isTauri }">
    <div class="stage-card" data-tauri-drag-region>
      <VoiceStage
        :orb-state="orbState"
        :caption="caption"
        :status-line="statusLine"
        :is-muted="isMuted"
        :is-listening="isListening"
        @toggle-mute="toggleMute"
        @close="close"
      />
    </div>
  </div>
</template>

<style scoped>
.jarvis-window {
  height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg-shell);
}

/* Inside the Tauri shell the window itself is transparent — the card IS the
   overlay: rounded, softly bordered, draggable, and translucent so the
   desktop shows through. (backdrop-filter can't frost what's BEHIND a
   transparent Tauri window — the webview can only blur its own content — so
   translucency without blur is the honest look.) */
.jarvis-window.is-tauri {
  background: transparent;
}

/* A translucent glass card behind the stage (reopened 2026-07-21 — the earlier
   free-floating look was unreadable over busy screens). Translucency without
   blur is the honest look: backdrop-filter can't frost what's BEHIND a
   transparent Tauri window. The card stays the drag region. */
.is-tauri .stage-card {
  background: rgb(8 11 16 / 0.78);
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: 24px;
  box-shadow: 0 12px 48px rgb(0 0 0 / 0.5);
}

/* Belt over the glass — a bright desktop can still glow through 22% translucency. */
.is-tauri :deep(.caption) {
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
}
</style>
