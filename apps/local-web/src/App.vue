<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import TitleBar from "./components/shell/TitleBar.vue";
import ApprovalNotifier from "./components/shell/ApprovalNotifier.vue";
import VoiceOverlay from "./components/voice/VoiceOverlay.vue";
import SessionViewerPanel from "./components/session-viewer/SessionViewerPanel.vue";
import OnboardingWizard from "./components/onboarding/OnboardingWizard.vue";
import { useOnboardingStore } from "./stores/onboarding-store.js";

// Bare routes (the floating Jarvis window) render their view alone — no shell,
// and crucially no VoiceOverlay: two daemon links in one window would double
// the voice session.
const route = useRoute();
const isBare = computed(() => route.meta.bare === true);

// First-launch: when any call answers the gate's 412, the wizard takes over
// the window (the shell unmounts, so nothing keeps polling into the gate).
const onboardingStore = useOnboardingStore();
const queryClient = useQueryClient();

function finishOnboarding() {
  onboardingStore.markCompleted();
  // Everything fetched before (or during) setup is untrustworthy — refetch
  // the world now that the gate is open.
  void queryClient.invalidateQueries();
}
</script>

<template>
  <RouterView v-if="isBare" />
  <OnboardingWizard
    v-else-if="onboardingStore.isRequired"
    @completed="finishOnboarding"
  />
  <div v-else class="app-shell">
    <TitleBar />
    <main class="app-body">
      <RouterView />
    </main>
    <SessionViewerPanel />
    <ApprovalNotifier />
    <VoiceOverlay />
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-rows: 40px 1fr;
  height: 100vh;
  background: var(--bg-shell);
  color: var(--ink-1);
}

.app-body {
  min-height: 0;
  overflow: hidden;
}
</style>
