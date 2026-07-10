<script setup lang="ts">
import { computed, ref } from "vue";
import { LogIn } from "lucide-vue-next";
import { useHubSignIn } from "../../composables/hub/use-hub-sign-in.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Email + password against the hub. Accounts are provisioned by the Vynel
// provider — there is deliberately no self-serve sign-up path here.
const email = ref("");
const password = ref("");

const signIn = useHubSignIn();

const canSignIn = computed(
  () =>
    email.value.trim().length > 0 &&
    password.value.length > 0 &&
    !signIn.isPending.value,
);

const errorMessage = computed(() =>
  signIn.error.value ? formatSdkError(signIn.error.value) : null,
);

function submit() {
  if (!canSignIn.value) return;
  signIn.mutate(
    { email: email.value.trim(), password: password.value },
    // The password did its job — don't keep it around after the attempt lands.
    { onSuccess: () => (password.value = "") },
  );
}
</script>

<template>
  <form class="sign-in-card" @submit.prevent="submit">
    <label class="field">
      <span class="field-label">Email</span>
      <input
        v-model="email"
        type="email"
        autocomplete="email"
        :disabled="signIn.isPending.value"
      />
    </label>

    <label class="field">
      <span class="field-label">Password</span>
      <input
        v-model="password"
        type="password"
        autocomplete="current-password"
        :disabled="signIn.isPending.value"
      />
    </label>

    <p v-if="errorMessage" class="form-error" role="alert">
      {{ errorMessage }}
    </p>

    <div class="form-actions">
      <button type="submit" class="invite-button" :disabled="!canSignIn">
        <LogIn :size="13" />
        {{ signIn.isPending.value ? "Signing in…" : "Sign in" }}
      </button>
    </div>

    <p class="form-hint">
      Accounts are created by your Vynel provider — there is no sign-up here.
    </p>
  </form>
</template>

<style scoped>
.sign-in-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
}

.field {
  display: grid;
  gap: 5px;
}

.field-label {
  color: var(--ink-2);
  font: 600 11.5px/1.5 var(--font-ui);
}

.field input {
  appearance: none;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 400 12.5px/1.5 var(--font-ui);
}

.field input:disabled {
  opacity: 0.55;
}

.field input:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -1px;
}

.form-error {
  margin: 0;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.form-actions {
  display: flex;
  justify-content: flex-start;
}

.invite-button {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 14px;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  background: var(--bg-panel);
  color: var(--ink-2);
  font: 600 11.5px/1.6 var(--font-ui);
  cursor: default;
  flex: none;
  transition: border-color var(--t-fast) var(--ease-out);
}

.invite-button:hover:not(:disabled) {
  color: var(--ink-1);
  background: var(--row-hover);
}

.invite-button:disabled {
  opacity: 0.55;
}

.invite-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.form-hint {
  margin: 0;
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}
</style>
