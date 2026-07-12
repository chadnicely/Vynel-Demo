<script setup lang="ts">
import { computed, ref } from "vue";
import { AdminApiError } from "../../lib/admin-api.js";
import { useProvisionAccount } from "../../composables/accounts/use-provision-account.js";

const provisionMutation = useProvisionAccount();

const email = ref("");
const displayName = ref("");

const provisionError = computed(() => {
  const error = provisionMutation.error.value;
  if (error === null) return null;
  return error instanceof AdminApiError
    ? error.message
    : "The request failed — try again.";
});

function provision() {
  provisionMutation.mutate(
    { email: email.value, displayName: displayName.value },
    {
      onSuccess: () => {
        email.value = "";
        displayName.value = "";
      },
    },
  );
}
</script>

<template>
  <form class="card" @submit.prevent="provision">
    <h2>Provision account</h2>
    <label class="field">
      <span class="field-label">Email</span>
      <input v-model="email" class="text-input" type="email" required />
    </label>
    <label class="field">
      <span class="field-label">Display name</span>
      <input v-model="displayName" class="text-input" type="text" required />
    </label>
    <button
      type="submit"
      class="button button-primary"
      :disabled="provisionMutation.isPending.value"
    >
      {{ provisionMutation.isPending.value ? "Provisioning…" : "Provision" }}
    </button>
    <p v-if="provisionError" class="form-error">{{ provisionError }}</p>
    <div v-else-if="provisionMutation.data.value" class="form-success">
      <p class="created-id">
        Created account
        <code>{{ provisionMutation.data.value.accountId }}</code>
      </p>
      <p class="muted-note">
        In dev, the set-password link appears in the hub's server log.
      </p>
    </div>
  </form>
</template>

<style scoped>
.card {
  max-width: 420px;
}

h2 {
  font-size: 14px;
  margin: 0 0 12px;
}

.created-id {
  margin: 8px 0 4px;
}

code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-raised);
  padding: 1px 5px;
  border-radius: 4px;
}
</style>
