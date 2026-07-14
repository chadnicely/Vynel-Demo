<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import AppShell from "./components/shell/AppShell.vue";
import OnboardingWizard from "./components/onboarding/OnboardingWizard.vue";
import { useOnboardingStore } from "./stores/onboarding-store.js";

// Bare routes (the floating Jarvis window, dev previews) render their view alone
// — no shell, and crucially no shell data hooks (the /jarvis overlay must not
// run the approvals poll or a second voice link). The full desktop shell lives
// in AppShell, mounted only for real surfaces below.
const route = useRoute();
const isBare = computed(() => route.meta.bare === true);

// First-launch: when any call answers the gate's 412, the wizard takes over the
// window (the shell unmounts, so nothing keeps polling into the gate).
const onboardingStore = useOnboardingStore();
const queryClient = useQueryClient();

function finishOnboarding() {
  onboardingStore.markCompleted();
  void queryClient.invalidateQueries();
}
</script>

<template>
  <RouterView v-if="isBare" />
  <OnboardingWizard
    v-else-if="onboardingStore.isRequired"
    @completed="finishOnboarding"
  />
  <AppShell v-else />
</template>
