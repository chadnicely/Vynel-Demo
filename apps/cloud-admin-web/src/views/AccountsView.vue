<script setup lang="ts">
import { computed, ref } from "vue";
import type { HubAccountRole } from "@vynel/contracts/hub/admin";
import { AdminApiError } from "../lib/admin-api.js";
import { useGrantAccountRole } from "../composables/accounts/use-grant-account-role.js";
import { useProvisionAccount } from "../composables/accounts/use-provision-account.js";

const provisionMutation = useProvisionAccount();
const roleMutation = useGrantAccountRole();

const email = ref("");
const displayName = ref("");
const roleAccountId = ref("");
const role = ref<HubAccountRole>("admin");

function mutationErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  return error instanceof AdminApiError
    ? error.message
    : "The request failed — try again.";
}

const provisionError = computed(() =>
  mutationErrorMessage(provisionMutation.error.value),
);
const roleError = computed(() =>
  mutationErrorMessage(roleMutation.error.value),
);

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

function grantRole() {
  roleMutation.mutate({ accountId: roleAccountId.value, role: role.value });
}
</script>

<template>
  <section>
    <h1 class="page-title">Accounts</h1>
    <p class="muted-note intro">
      The hub has no list-accounts endpoint yet, so there's no account table
      here — this page provisions accounts and grants roles.
    </p>
    <div class="accounts-grid">
      <form class="card" @submit.prevent="provision">
        <h2>Provision account</h2>
        <label class="field">
          <span class="field-label">Email</span>
          <input v-model="email" class="text-input" type="email" required />
        </label>
        <label class="field">
          <span class="field-label">Display name</span>
          <input
            v-model="displayName"
            class="text-input"
            type="text"
            required
          />
        </label>
        <button
          type="submit"
          class="button button-primary"
          :disabled="provisionMutation.isPending.value"
        >
          {{
            provisionMutation.isPending.value ? "Provisioning…" : "Provision"
          }}
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

      <form class="card" @submit.prevent="grantRole">
        <h2>Grant role</h2>
        <label class="field">
          <span class="field-label">Account id</span>
          <input
            v-model="roleAccountId"
            class="text-input"
            type="text"
            required
          />
        </label>
        <label class="field">
          <span class="field-label">Role</span>
          <select v-model="role" class="select-input">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button
          type="submit"
          class="button button-primary"
          :disabled="roleMutation.isPending.value"
        >
          {{ roleMutation.isPending.value ? "Granting…" : "Grant role" }}
        </button>
        <p v-if="roleError" class="form-error">{{ roleError }}</p>
        <p v-else-if="roleMutation.data.value" class="form-success">
          {{ roleMutation.data.value.accountId }} is now a
          {{ roleMutation.data.value.role }}.
        </p>
      </form>
    </div>
  </section>
</template>

<style scoped>
.page-title {
  font-size: 17px;
  margin: 0 0 8px;
}

.intro {
  margin: 0 0 16px;
}

.accounts-grid {
  display: grid;
  grid-template-columns: minmax(280px, 420px) minmax(280px, 420px);
  gap: 16px;
  align-items: start;
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
