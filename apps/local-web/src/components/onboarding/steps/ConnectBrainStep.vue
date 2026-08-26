<script setup lang="ts">
import { computed } from "vue";
import type { ConnectBrainStepInput } from "@vynel/contracts/onboarding/onboarding-step-inputs";
import { useClaudeAuthStatus } from "../../../composables/providers/use-claude-auth-status.js";
import ClaudeLoginFlow from "../../providers/ClaudeLoginFlow.vue";
import StepActions from "../StepActions.vue";

// Step 4 — "Connect a brain", from Chad's Welcome prototype.
//
// Claude is the only brain Vynel can actually build with today, so Codex and
// Kimi are shown-but-off rather than hidden (Chad, 2026-08-24: "just do Claude
// for now... you can turn off the other 2"). Showing them greyed says "coming",
// which is true; hiding them would make the choice look settled forever, and a
// live-looking button that cannot work is the worse of the two lies.
//
// The sign-in is the SAME flow as the account popup (`ClaudeLoginFlow`) — the
// CLI owns the credential and Vynel never sees a token. No second sign-in path
// to drift from the first.
const props = defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ submit: [input: ConnectBrainStepInput] }>();

const status = useClaudeAuthStatus(() => true);

const isConnected = computed(() => status.data.value?.isAuthenticated === true);
const accountLabel = computed(
  () => status.data.value?.authenticatedAccountLabel ?? null,
);
const isInstalled = computed(() => status.data.value?.isInstalled !== false);

const OTHER_BRAINS = [
  { id: "codex", name: "Codex", uses: "Uses your ChatGPT account." },
  { id: "kimi", name: "Kimi", uses: "Uses your Moonshot account." },
] as const;
</script>

<template>
  <form
    class="brains"
    @submit.prevent="emit('submit', { providerId: 'claude' })"
  >
    <!-- The header already carries "Vynel builds with your own AI account"
         (the catalog's one-line description) — this says the part it doesn't. -->
    <p class="lede">
      Your own subscription does the building, so there is nothing extra to pay
      for each project.
    </p>

    <ul class="options">
      <li class="option" :class="{ connected: isConnected }">
        <div class="option-head">
          <span class="option-name">Claude</span>
          <span v-if="isConnected" class="badge connected-badge">
            Connected
          </span>
        </div>
        <span class="option-body">
          <template v-if="isConnected">
            {{ accountLabel ?? "Signed in on this computer." }}
          </template>
          <template v-else-if="!isInstalled">
            Claude Code isn't installed on this computer yet.
          </template>
          <template v-else> Uses your Claude subscription. </template>
        </span>

        <ClaudeLoginFlow
          v-if="!isConnected && isInstalled"
          idle-label="Sign in to Claude"
        />
      </li>

      <!-- Shown, not offered: these are real plans, not live options. -->
      <li v-for="brain in OTHER_BRAINS" :key="brain.id" class="option muted">
        <div class="option-head">
          <span class="option-name">{{ brain.name }}</span>
          <span class="badge">Not yet</span>
        </div>
        <span class="option-body">{{ brain.uses }}</span>
      </li>
    </ul>

    <p v-if="!isConnected" class="gate">
      Sign in to Claude to carry on — Vynel can't build without a brain.
    </p>

    <StepActions
      primary-label="Use Claude"
      :busy="props.busy"
      :disabled="!isConnected"
    />
  </form>
</template>

<style scoped>
.lede {
  margin: 0 0 18px;
  color: var(--ink-2);
  font: 400 13.5px/1.65 var(--font-ui);
}

.options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.option {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
}

.option.connected {
  border-color: var(--gold);
}

.option.muted {
  opacity: 0.55;
}

.option-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.option-name {
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
}

.option-body {
  color: var(--ink-3);
  font: 400 12px/1.55 var(--font-ui);
}

.badge {
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  padding: 1px 7px;
  color: var(--ink-3);
  font: 600 10px/1.6 var(--font-ui);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.connected-badge {
  border-color: var(--gold);
  color: var(--gold);
}

.gate {
  margin: 14px 0 0;
  color: var(--ink-3);
  font: 400 12px/1.55 var(--font-ui);
}
</style>
