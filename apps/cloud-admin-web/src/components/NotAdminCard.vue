<script setup lang="ts">
import { ShieldOff } from "lucide-vue-next";

// Sign-in is the generic hub surface, so a member CAN sign in — the admin
// gate is per-request. When any /admin call answers 403 this card takes over.
defineEmits<{ "sign-out": [] }>();
</script>

<template>
  <div class="not-admin-page">
    <div class="card not-admin-card">
      <ShieldOff :size="28" class="icon" />
      <h1>This account isn't an admin</h1>
      <p>
        You're signed in, but the hub only opens the admin surface to accounts
        with the admin role. Ask an existing admin to grant it, then sign in
        again.
      </p>
      <button
        type="button"
        class="button button-primary"
        @click="$emit('sign-out')"
      >
        Sign out
      </button>
    </div>
  </div>
</template>

<style scoped>
.not-admin-page {
  display: grid;
  place-items: center;
  height: 100vh;
  background: var(--bg-shell);
}

.not-admin-card {
  max-width: 380px;
  text-align: center;
}

.icon {
  color: var(--danger);
}

h1 {
  font-size: 17px;
  margin: 12px 0 8px;
}

p {
  color: var(--ink-2);
  margin: 0 0 16px;
}
</style>
