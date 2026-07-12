<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  HubAccountRole,
  HubAdminAccount,
} from "@vynel/contracts/hub/admin";
import type { HubTier } from "@vynel/contracts/hub/entitlements";
import ProvisionAccountCard from "../components/accounts/ProvisionAccountCard.vue";
import { AdminApiError } from "../lib/admin-api.js";
import { formatDate } from "../lib/format.js";
import { useAdminAccounts } from "../composables/accounts/use-admin-accounts.js";
import { useGrantAccountRole } from "../composables/accounts/use-grant-account-role.js";
import { useSetAccountStatus } from "../composables/accounts/use-set-account-status.js";
import { useSetAccountTier } from "../composables/accounts/use-set-account-tier.js";

const accountsQuery = useAdminAccounts();
const roleMutation = useGrantAccountRole();
const tierMutation = useSetAccountTier();
const statusMutation = useSetAccountStatus();

// Disable is destructive-ish (kills every device session) — first click arms
// the row, the second confirms.
const confirmingDisableId = ref<string | null>(null);

function mutationErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  return error instanceof AdminApiError
    ? error.message
    : "The request failed — try again.";
}

const tableError = computed(
  () =>
    mutationErrorMessage(roleMutation.error.value) ??
    mutationErrorMessage(tierMutation.error.value) ??
    mutationErrorMessage(statusMutation.error.value),
);

// The failed select must snap back to the server's value — vue won't re-patch
// a DOM select whose vnode value never changed.
function changeRole(account: HubAdminAccount, event: Event) {
  const select = event.target as HTMLSelectElement;
  roleMutation.mutate(
    { accountId: account.id, role: select.value as HubAccountRole },
    { onError: () => (select.value = account.role) },
  );
}

function changeTier(account: HubAdminAccount, event: Event) {
  const select = event.target as HTMLSelectElement;
  tierMutation.mutate(
    { accountId: account.id, tier: select.value as HubTier },
    { onError: () => (select.value = account.tier) },
  );
}

function toggleStatus(account: HubAdminAccount) {
  if (account.status === "disabled") {
    statusMutation.mutate({ accountId: account.id, status: "active" });
    return;
  }
  if (confirmingDisableId.value !== account.id) {
    confirmingDisableId.value = account.id;
    return;
  }
  statusMutation.mutate(
    { accountId: account.id, status: "disabled" },
    { onSettled: () => (confirmingDisableId.value = null) },
  );
}
</script>

<template>
  <section>
    <h1 class="page-title">Accounts</h1>

    <p v-if="accountsQuery.isPending.value" class="muted-note">
      Loading accounts…
    </p>
    <div v-else-if="accountsQuery.isError.value" class="card">
      <p class="form-error">{{ accountsQuery.error.value?.message }}</p>
      <button type="button" class="button" @click="accountsQuery.refetch()">
        Retry
      </button>
    </div>
    <p
      v-else-if="(accountsQuery.data.value ?? []).length === 0"
      class="muted-note"
    >
      No accounts yet — provision the first one below.
    </p>
    <table v-else class="accounts-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>Name</th>
          <th>Role</th>
          <th>Tier</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="account in accountsQuery.data.value"
          :key="account.id"
          :class="{ disabled: account.status === 'disabled' }"
        >
          <td class="mono">{{ account.email }}</td>
          <td>{{ account.displayName }}</td>
          <td>
            <select
              class="select-input compact"
              :value="account.role"
              :aria-label="`Role for ${account.email}`"
              @change="changeRole(account, $event)"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </td>
          <td>
            <select
              class="select-input compact"
              :value="account.tier"
              :aria-label="`Tier for ${account.email}`"
              @change="changeTier(account, $event)"
            >
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
            </select>
            <span v-if="account.tierExpiresAt" class="tier-expiry">
              until {{ formatDate(account.tierExpiresAt) }}
            </span>
          </td>
          <td>
            <template v-if="confirmingDisableId === account.id">
              <span class="confirm-hint">Kills every session.</span>
              <button
                type="button"
                class="button button-danger"
                :disabled="statusMutation.isPending.value"
                @click="toggleStatus(account)"
              >
                Confirm disable
              </button>
              <button
                type="button"
                class="button"
                @click="confirmingDisableId = null"
              >
                Cancel
              </button>
            </template>
            <template v-else>
              <span class="status-word">{{ account.status }}</span>
              <button
                type="button"
                class="button"
                :disabled="statusMutation.isPending.value"
                @click="toggleStatus(account)"
              >
                {{ account.status === "disabled" ? "Enable" : "Disable" }}
              </button>
            </template>
          </td>
          <td>{{ formatDate(account.createdAt) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="tableError" class="form-error">{{ tableError }}</p>

    <h2 class="section-title">New account</h2>
    <ProvisionAccountCard />
  </section>
</template>

<style scoped>
.page-title {
  font-size: 17px;
  margin: 0 0 16px;
}

.section-title {
  font-size: 14px;
  margin: 24px 0 12px;
}

.accounts-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th {
  text-align: left;
  color: var(--ink-3);
  font-weight: 500;
  font-size: 12px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--hair-strong);
}

td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--hair);
  vertical-align: middle;
}

tr.disabled td {
  color: var(--ink-3);
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
}

.select-input.compact {
  padding: 3px 6px;
  font-size: 12px;
}

.tier-expiry,
.status-word,
.confirm-hint {
  font-size: 12px;
  color: var(--ink-3);
  margin-right: 8px;
}

.status-word {
  text-transform: capitalize;
}

td .button + .button {
  margin-left: 6px;
}
</style>
