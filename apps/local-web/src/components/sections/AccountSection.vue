<script setup lang="ts">
import { computed } from "vue";
import { CloudOff, Lock, LogOut, Unplug, UserRound } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useHubSession } from "../../composables/hub/use-hub-session.js";
import { useHubDevices } from "../../composables/hub/use-hub-devices.js";
import { useHubSignOut } from "../../composables/hub/use-hub-sign-out.js";
import { useRevokeHubDevice } from "../../composables/hub/use-revoke-hub-device.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import AccountSignInForm from "./AccountSignInForm.vue";
import AccountDeviceRow from "./AccountDeviceRow.vue";

// The account section — global menu only: the hub link belongs to the app,
// not to any workspace. Renders the daemon's HubLinkStatus union; a failed
// status query renders as nothing under the header (siblings' convention).
const sessionQuery = useHubSession();
const status = computed(() => sessionQuery.data.value ?? null);

const devicesQuery = useHubDevices(() => status.value?.kind === "signed-in");
const devices = computed(() => devicesQuery.data.value ?? []);

const signOut = useHubSignOut();
const revokeDevice = useRevokeHubDevice();

function isRevoking(deviceId: string): boolean {
  return (
    revokeDevice.isPending.value && revokeDevice.variables.value === deviceId
  );
}
</script>

<template>
  <div class="account-section">
    <header class="section-header">
      <UserRound :size="15" class="section-icon" />
      <div class="section-text">
        <p class="section-title">Account</p>
        <p class="section-hint">The Vynel account this app is linked to</p>
      </div>
      <button
        v-if="status?.kind === 'signed-in'"
        type="button"
        class="add-button"
        :disabled="signOut.isPending.value"
        @click="signOut.mutate()"
      >
        <LogOut :size="13" />
        {{ signOut.isPending.value ? "Signing out…" : "Sign out" }}
      </button>
    </header>

    <EmptyState
      v-if="status?.kind === 'not-configured'"
      title="No hub configured"
      hint="Connect this app to a Vynel account by setting VYNEL_HUB_URL in the daemon environment."
    >
      <template #icon>
        <Unplug :size="22" />
      </template>
    </EmptyState>

    <AccountSignInForm v-else-if="status?.kind === 'signed-out'" />

    <template v-else-if="status?.kind === 'signed-in'">
      <div class="identity-card">
        <span class="identity-icon">
          <UserRound :size="16" />
        </span>
        <div class="identity-main">
          <p class="identity-name">{{ status.displayName }}</p>
          <p class="identity-sub">{{ status.email }}</p>
        </div>
        <span class="identity-time">
          Checked {{ formatRelativeTime(status.checkedAt) }}
        </span>
      </div>

      <div class="devices-block">
        <p class="block-label">Devices</p>
        <div v-if="devices.length > 0" class="rows">
          <AccountDeviceRow
            v-for="device in devices"
            :key="device.id"
            :device="device"
            :is-revoking="isRevoking(device.id)"
            @revoke="revokeDevice.mutate"
          />
        </div>
        <p v-else class="block-empty">No devices to show.</p>
      </div>
    </template>

    <div v-else-if="status?.kind === 'locked'" class="status-card">
      <span class="status-icon is-attention">
        <Lock :size="16" />
      </span>
      <div class="status-main">
        <p class="status-title">Account locked</p>
        <p class="status-sub">{{ status.message }}</p>
        <!-- The lock verdict is re-checked slowly; a re-enabled user needs a
             way back to the form NOW, not at the next daily check. -->
        <button
          type="button"
          class="add-button"
          :disabled="signOut.isPending.value"
          @click="signOut.mutate()"
        >
          Sign in again
        </button>
      </div>
    </div>

    <div v-else-if="status?.kind === 'offline'" class="status-card">
      <span class="status-icon">
        <CloudOff :size="16" />
      </span>
      <div class="status-main">
        <p class="status-title">
          {{ status.displayName ?? "Signed in" }}
          <span v-if="status.email" class="status-email">{{
            status.email
          }}</span>
        </p>
        <p class="status-sub">
          Can't reach the hub — will retry automatically.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account-section {
  display: grid;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 2px 4px;
}

.section-icon {
  color: var(--ink-2);
  flex: none;
  margin-top: 2px;
}

.section-text {
  min-width: 0;
  flex: 1;
}

.section-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 13px/1.5 var(--font-ui);
}

.section-hint {
  margin: 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.add-button {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 11px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: transparent;
  color: var(--ink-2);
  font: 600 11.5px/1.6 var(--font-ui);
  cursor: default;
  flex: none;
  transition: border-color var(--t-fast) var(--ease-out);
}

.add-button:hover:not(:disabled) {
  color: var(--ink-1);
  border-color: var(--hair-strong);
  background: var(--row-hover);
}

.add-button:disabled {
  opacity: 0.55;
}

.add-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.identity-card,
.status-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
}

.identity-icon,
.status-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-2);
  flex: none;
}

/* Locked is an attention state, not an emergency — the house gold "attention"
   language (Channels' warn pill), never an alarmist red. */
.status-icon.is-attention {
  color: var(--gold);
  background: var(--gold-soft);
  border-color: transparent;
}

.identity-main,
.status-main {
  min-width: 0;
  flex: 1;
}

.identity-name,
.status-title {
  margin: 0;
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
  display: flex;
  align-items: center;
  gap: 6px;
}

.identity-sub,
.status-sub {
  margin: 1px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}

.identity-time {
  color: var(--ink-3);
  font: 400 10.5px/1.6 var(--font-ui);
  flex: none;
}

.status-email {
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}

.devices-block {
  display: grid;
  gap: 6px;
}

.block-label {
  margin: 4px 4px 0;
  color: var(--ink-2);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.rows {
  display: grid;
  gap: 4px;
}

.block-empty {
  margin: 0 4px;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
}
</style>
