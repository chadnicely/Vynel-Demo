import { ref } from "vue";
import { defineStore } from "pinia";

// Whether the window must show the first-launch wizard instead of the app
// shell. Flipped on by the data layer when any call answers the first-launch
// gate's 412 (`onboarding_required`), flipped off when the wizard completes.
// Server state (the run itself) lives in vue-query; this is pure UI state.
export const useOnboardingStore = defineStore("onboarding", () => {
  const isRequired = ref(false);

  function markRequired() {
    isRequired.value = true;
  }

  function markCompleted() {
    isRequired.value = false;
  }

  return { isRequired, markRequired, markCompleted };
});
