<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  useOnboardingRunStatus,
  useRestartOnboarding,
  useStartOnboarding,
  useSubmitOnboardingStep,
  type OnboardingStepKind,
} from "../../composables/onboarding/use-onboarding-run.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import WizardBootScreen from "./WizardBootScreen.vue";
import WizardBrand from "./WizardBrand.vue";
import WizardDoneScreen from "./WizardDoneScreen.vue";
import WizardFireworks from "./WizardFireworks.vue";
import WizardProgressHeader from "./WizardProgressHeader.vue";
import WizardStepBody from "./WizardStepBody.vue";
import WelcomeStep from "./steps/WelcomeStep.vue";
import ProfileStep from "./steps/ProfileStep.vue";
import IdentitySeedStep from "./steps/IdentitySeedStep.vue";
import ConnectBrainStep from "./steps/ConnectBrainStep.vue";
import GitHubBackupStep from "./steps/GitHubBackupStep.vue";

// The first-launch wizard — takes over the whole window until the run
// completes (the API's first-launch gate 412s everything else anyway).
// Server truth drives it: the run/status snapshot decides which step shows.
const emit = defineEmits<{
  /** Setup is done, and which door the user picked on the way out — the shell
   *  opens it so the "new or existing" question is asked exactly once. */
  completed: [choice: "new" | "existing"];
}>();

const runId = ref<string | null>(null);

const start = useStartOnboarding();
const restart = useRestartOnboarding();
const statusQuery = useOnboardingRunStatus(runId);
const submit = useSubmitOnboardingStep();

// A completed submit is terminal even before the snapshot refetches.
const submittedComplete = ref(false);
// The congratulations beat. Cleared when the done screen turns into the
// "new or existing?" question.
const isCelebrating = ref(true);

function startRun() {
  start.reset();
  start.mutate(undefined, {
    onSuccess: (run) => {
      runId.value = run.id;
    },
  });
}

onMounted(startRun);

const snapshot = computed(() => statusQuery.data.value);
const currentStepKind = computed<OnboardingStepKind | null>(
  () => snapshot.value?.run.currentStepKind ?? null,
);
const isComplete = computed(
  () => submittedComplete.value || snapshot.value?.run.status === "completed",
);
const displayName = computed(
  () => snapshot.value?.collectedData.profile?.displayName ?? null,
);
const busy = computed(() => submit.isPending.value);

const errorMessage = computed(() => {
  const error =
    submit.error.value ??
    start.error.value ??
    restart.error.value ??
    statusQuery.error.value;
  return error ? formatSdkError(error) : null;
});

// Either boot call failing must surface — this is the first screen a fresh
// install shows, and a silent hang here bricks the whole app.
const bootError = computed(() =>
  start.isError.value || statusQuery.isError.value ? errorMessage.value : null,
);

function retryBoot() {
  if (start.isError.value || runId.value === null) {
    startRun();
    return;
  }
  void statusQuery.refetch();
}

function submitCurrent(stepInput: unknown) {
  const kind = currentStepKind.value;
  if (runId.value === null || kind === null) return;
  submit.mutate(
    { runId: runId.value, stepKind: kind, stepInput },
    {
      onSuccess: (run) => {
        if (run.status === "completed") submittedComplete.value = true;
      },
    },
  );
}

function startOver() {
  restart.mutate(undefined, {
    onSuccess: (run) => {
      submittedComplete.value = false;
      runId.value = run.id;
    },
  });
}
</script>

<template>
  <div class="wizard">
    <!-- Behind the card, across the whole backdrop — the celebration is the
         room, not a decoration inside the panel (Chad, 2026-08-24). It stops
         the moment the card becomes a question: `v-if` unmounts the canvas,
         which cancels its animation frame rather than leaving it burning
         behind the next screen. -->
    <WizardFireworks v-if="isComplete && isCelebrating" />

    <div class="card">
      <WizardBrand />

      <WizardBootScreen
        v-if="!isComplete && snapshot === undefined"
        :error="bootError"
        @retry="retryBoot"
      />

      <WizardDoneScreen
        v-else-if="isComplete"
        :display-name="displayName"
        @choosing="isCelebrating = false"
        @open="(choice) => emit('completed', choice)"
      />

      <template v-else-if="snapshot">
        <WizardProgressHeader
          :order="snapshot.currentStep.order"
          :total-steps="snapshot.totalSteps"
          :completed-step-count="snapshot.completedStepCount"
          :display-label="snapshot.currentStep.displayLabel"
          :one-line-description="snapshot.currentStep.oneLineDescription"
        />

        <Transition name="step" mode="out-in">
          <WizardStepBody :key="currentStepKind ?? 'none'">
            <WelcomeStep
              v-if="currentStepKind === 'welcome'"
              :busy="busy"
              @submit="submitCurrent"
            />
            <ProfileStep
              v-else-if="currentStepKind === 'profile'"
              :busy="busy"
              @submit="submitCurrent"
            />
            <IdentitySeedStep
              v-else-if="currentStepKind === 'identity-seed'"
              :busy="busy"
              @submit="submitCurrent"
            />
            <ConnectBrainStep
              v-else-if="currentStepKind === 'connect-brain'"
              :busy="busy"
              @submit="submitCurrent"
            />
            <GitHubBackupStep
              v-else-if="currentStepKind === 'github-backup'"
              :busy="busy"
              @submit="submitCurrent"
            />
          </WizardStepBody>
        </Transition>

        <p v-if="errorMessage" class="submit-error" role="alert">
          {{ errorMessage }}
        </p>

        <footer class="wizard-footer">
          <button type="button" class="start-over" @click="startOver">
            Start over
          </button>
        </footer>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wizard {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: var(--bg-shell);
  overflow-y: auto;
  padding: 32px 16px;
}

.card {
  /* Above the fireworks — they burst behind it, never over the words. */
  position: relative;
  z-index: 1;
  width: min(580px, 94vw);
  background: var(--bg-panel);
  border: 1px solid var(--hair);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-overlay);
  padding: 26px 30px 22px;
}

.submit-error {
  margin: 14px 0 0;
  color: var(--danger);
  font: 400 12px/1.55 var(--font-ui);
}

.wizard-footer {
  display: flex;
  justify-content: center;
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--hair);
}

.start-over {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font: 500 11.5px/1.6 var(--font-ui);
}

.start-over:hover {
  color: var(--ink-2);
}

.step-enter-active,
.step-leave-active {
  transition:
    opacity var(--t-slow) var(--ease-out),
    transform var(--t-slow) var(--ease-out);
}

.step-enter-from {
  opacity: 0;
  transform: translateX(14px);
}

.step-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

@media (prefers-reduced-motion: reduce) {
  .step-enter-active,
  .step-leave-active {
    transition: none;
  }
}
</style>
