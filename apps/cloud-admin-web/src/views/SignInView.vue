<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { AdminApiError } from "../lib/admin-api.js";
import { useAdminSession } from "../composables/use-admin-session.js";

const router = useRouter();
const { signIn } = useAdminSession();

const email = ref("");
const password = ref("");
const pending = ref(false);
const errorMessage = ref<string | null>(null);

async function handleSubmit() {
  if (pending.value) return;
  pending.value = true;
  errorMessage.value = null;
  try {
    await signIn(email.value, password.value);
    await router.push({ name: "catalog" });
  } catch (error) {
    errorMessage.value =
      error instanceof AdminApiError
        ? error.message
        : "Could not reach the hub — check your connection and try again.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="sign-in-page">
    <form class="card sign-in-card" @submit.prevent="handleSubmit">
      <h1>Vynel Hub Admin</h1>
      <p class="muted-note">Sign in with your hub account.</p>
      <label class="field">
        <span class="field-label">Email</span>
        <input
          v-model="email"
          class="text-input"
          type="email"
          name="email"
          autocomplete="email"
          required
        />
      </label>
      <label class="field">
        <span class="field-label">Password</span>
        <input
          v-model="password"
          class="text-input"
          type="password"
          name="password"
          autocomplete="current-password"
          required
        />
      </label>
      <button
        type="submit"
        class="button button-primary submit"
        :disabled="pending"
      >
        {{ pending ? "Signing in…" : "Sign in" }}
      </button>
      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
    </form>
  </div>
</template>

<style scoped>
.sign-in-page {
  display: grid;
  place-items: center;
  height: 100vh;
  background: var(--bg-shell);
}

.sign-in-card {
  width: 320px;
}

h1 {
  font-size: 17px;
  margin: 0 0 4px;
}

.muted-note {
  margin: 0 0 16px;
}

.submit {
  width: 100%;
  margin-top: 4px;
}
</style>
