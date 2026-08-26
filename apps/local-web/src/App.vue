<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import AppShell from "./components/shell/AppShell.vue";
import OnboardingWizard from "./components/onboarding/OnboardingWizard.vue";
import { useOnboardingStore } from "./stores/onboarding-store.js";

// Bare routes (the display dock, dev previews) render their view alone
// — no shell, and crucially no shell data hooks (the /display-dock window must not
// run the approvals poll or a second voice link). The full desktop shell lives
// in AppShell, mounted only for real surfaces below.
const route = useRoute();
const isBare = computed(() => route.meta.bare === true);

// First-launch: when any call answers the gate's 412, the wizard takes over the
// window (the shell unmounts, so nothing keeps polling into the gate).
const onboardingStore = useOnboardingStore();
const queryClient = useQueryClient();

// The wizard's last screen asked "something new, or something you already
// have?" — the answer parks in the store for the shell to open once mounted.
function finishOnboarding(choice: "new" | "existing") {
  onboardingStore.markCompleted(choice);
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
