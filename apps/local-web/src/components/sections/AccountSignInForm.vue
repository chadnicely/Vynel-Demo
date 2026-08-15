<script setup lang="ts">
import { computed, ref } from "vue";
import { PhSignIn as LogIn } from "@phosphor-icons/vue";
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
  <form
    class="sign-in-card grid gap-3 rounded-lg border border-hair bg-raised p-3.5"
    @submit.prevent="submit"
  >
    <label class="grid gap-1.5">
      <span class="text-xs font-semibold text-ink-2">Email</span>
      <input
        v-model="email"
        type="email"
        autocomplete="email"
        :disabled="signIn.isPending.value"
        class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-[7px] text-sm text-ink-1 disabled:opacity-55"
      />
    </label>

    <label class="grid gap-1.5">
      <span class="text-xs font-semibold text-ink-2">Password</span>
      <input
        v-model="password"
        type="password"
        autocomplete="current-password"
        :disabled="signIn.isPending.value"
        class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-[7px] text-sm text-ink-1 disabled:opacity-55"
      />
    </label>

    <p v-if="errorMessage" class="m-0 text-[12px] text-danger" role="alert">
      {{ errorMessage }}
    </p>

    <div class="flex justify-start">
      <button
        type="submit"
        class="invite-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-panel px-3.5 py-[5px] text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1 disabled:opacity-55"
        :disabled="!canSignIn"
      >
        <LogIn :size="13" />
        {{ signIn.isPending.value ? "Signing in…" : "Sign in" }}
      </button>
    </div>

    <p class="m-0 text-[11px] text-ink-3">
      Accounts are created by your Vynel provider — there is no sign-up here.
    </p>
  </form>
</template>
