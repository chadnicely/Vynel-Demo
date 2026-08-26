<script setup lang="ts">
import { computed } from "vue";
import type { GitHubBackupStepInput } from "@vynel/contracts/onboarding/onboarding-step-inputs";
import {
  useGitHubConnection,
  useGitHubSignIn,
} from "../../../composables/github/use-github-connection.js";
import StepActions from "../StepActions.vue";

// Step 5 — "A safe copy on GitHub", from Chad's Welcome prototype.
//
// The sign-in is the device flow the rest of the app already uses: `gh` holds
// the token, Vynel never sees it. Skipping is a real answer — the prototype's
// own words are "Skip this — Vynel will offer it again the first time it
// matters", and a user with no GitHub account must never be walled out of
// setup.
const props = defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ submit: [input: GitHubBackupStepInput] }>();

const connection = useGitHubConnection();
const signIn = useGitHubSignIn();

const isConnected = computed(
  () => connection.data.value?.isAuthenticated === true,
);
const accountLabel = computed(() => connection.data.value?.accountLabel ?? null);
const isAwaitingBrowser = computed(
  () => signIn.state.value?.phase === "awaiting-browser",
);
</script>

<template>
  <form
    class="github"
    @submit.prevent="emit('submit', { kind: 'connected' })"
  >
    <p class="lede">
      Every project keeps its full history in a private repository under your
      own GitHub account. If this computer disappears tomorrow, your work
      doesn't.
    </p>

    <div class="panel" :class="{ connected: isConnected }">
      <template v-if="isConnected">
        <span class="panel-title">Connected</span>
        <span class="panel-body">{{
          accountLabel ?? "Signed in to GitHub."
        }}</span>
      </template>

      <template v-else-if="isAwaitingBrowser">
        <span class="panel-title">Waiting for your browser</span>
        <span class="panel-body">
          Finish signing in there and this carries on by itself.
        </span>
        <button type="button" class="secondary" @click="signIn.cancel()">
          Cancel
        </button>
      </template>

      <template v-else>
        <span class="panel-title">One button, one code — no passwords here.</span>
        <button
          type="button"
          class="secondary"
          :disabled="signIn.isBeginning.value"
          @click="signIn.begin()"
        >
          Connect GitHub
        </button>
      </template>

      <p v-if="signIn.errorMessage.value" class="error" role="alert">
        {{ signIn.errorMessage.value }}
      </p>
    </div>

    <p class="note">
      No GitHub account? Skip this — Vynel will offer it again the first time it
      matters.
    </p>

    <StepActions
      :primary-label="isConnected ? 'Continue' : 'Connect GitHub first'"
      :busy="props.busy"
      :disabled="!isConnected"
      skippable
      skip-label="Skip for now"
      @skip="emit('submit', { kind: 'skipped' })"
    />
  </form>
</template>

<style scoped>
.lede {
  margin: 0 0 18px;
  color: var(--ink-2);
  font: 400 13.5px/1.65 var(--font-ui);
}

.panel {
  display: grid;
  justify-items: start;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
}

.panel.connected {
  border-color: var(--gold);
}

.panel-title {
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
}

.panel-body {
  color: var(--ink-3);
  font: 400 12px/1.55 var(--font-ui);
}

.secondary {
  appearance: none;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  padding: 6px 14px;
  background: transparent;
  color: var(--ink-1);
  font: 600 12px/1.6 var(--font-ui);
  cursor: default;
}

.secondary:hover:not(:disabled) {
  border-color: var(--gold);
  color: var(--gold);
}

.secondary:disabled {
  opacity: 0.55;
}

.error {
  margin: 0;
  color: var(--danger);
  font: 400 12px/1.55 var(--font-ui);
}

.note {
  margin: 14px 0 0;
  color: var(--ink-3);
  font: 400 12px/1.55 var(--font-ui);
}
</style>
