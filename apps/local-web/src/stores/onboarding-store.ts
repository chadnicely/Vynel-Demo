import { ref } from "vue";
import { defineStore } from "pinia";

// Whether the window must show the first-launch wizard instead of the app
// shell. Flipped on by the data layer when any call answers the first-launch
// gate's 412 (`onboarding_required`), flipped off when the wizard completes.
// Server state (the run itself) lives in vue-query; this is pure UI state.

/** The door the finished wizard sent the user through — "new" opens the build
 *  wizard, "existing" opens the folder picker. Null once the shell has taken
 *  it, so it can never fire twice. */
export type PendingFirstProjectDoor = "new" | "existing" | null;

export const useOnboardingStore = defineStore("onboarding", () => {
  const isRequired = ref(false);
  // Setup's LAST screen asks "something new, or something you already have?" —
  // the one place that question is asked (Chad, 2026-08-24). The answer has to
  // survive the wizard unmounting and the shell mounting, so it parks here.
  const pendingFirstProjectDoor = ref<PendingFirstProjectDoor>(null);

  function markRequired() {
    isRequired.value = true;
  }

  function markCompleted(door: PendingFirstProjectDoor = null) {
    isRequired.value = false;
    pendingFirstProjectDoor.value = door;
  }

  /** Read-once: the shell opens the door and clears it, so a later re-render
   *  never reopens a dialog the user already dealt with. */
  function takeFirstProjectDoor(): PendingFirstProjectDoor {
    const door = pendingFirstProjectDoor.value;
    pendingFirstProjectDoor.value = null;
    return door;
  }

  return {
    isRequired,
    pendingFirstProjectDoor,
    markRequired,
    markCompleted,
    takeFirstProjectDoor,
  };
});
