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
import SectionHeader from "./SectionHeader.vue";

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

// "basic" → "Basic": the chip reads as a word, not a wire value.
function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <SectionHeader
      :icon="UserRound"
      title="Account"
      subtitle="The Vynel account this app is linked to"
    >
      <template v-if="status?.kind === 'signed-in'" #actions>
        <button
          type="button"
          class="add-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1 disabled:opacity-55"
          :disabled="signOut.isPending.value"
          @click="signOut.mutate()"
        >
          <LogOut :size="13" />
          {{ signOut.isPending.value ? "Signing out…" : "Sign out" }}
        </button>
      </template>
    </SectionHeader>

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
      <div
        class="identity-card group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <span
          class="grid size-9 shrink-0 place-items-center rounded-md bg-claude-soft text-sm font-semibold uppercase text-claude"
        >
          {{ status.displayName.charAt(0) }}
        </span>
        <div class="min-w-0 flex-1">
          <p
            class="identity-name m-0 flex items-center gap-1.5 text-sm font-semibold text-ink-1"
          >
            {{ status.displayName }}
            <!-- Absent when the entitlement couldn't be verified (key
                 mismatch): show no tier rather than a wrong one. -->
            <span
              v-if="status.tier !== null"
              class="tier-chip shrink-0 rounded-full border border-hair-strong px-[7px] text-[10px] font-semibold text-ink-3"
              >{{ tierLabel(status.tier) }}</span
            >
          </p>
          <p class="m-0 mt-0.5 text-xs text-ink-3">{{ status.email }}</p>
        </div>
        <span class="shrink-0 text-2xs text-ink-3">
          Checked {{ formatRelativeTime(status.checkedAt) }}
        </span>
      </div>

      <div class="grid gap-1.5">
        <p
          class="mx-1 mt-1 mb-0 text-2xs font-semibold uppercase tracking-wider text-ink-2"
        >
          Devices
        </p>
        <div v-if="devices.length > 0" class="flex flex-col gap-2">
          <AccountDeviceRow
            v-for="device in devices"
            :key="device.id"
            :device="device"
            :is-revoking="isRevoking(device.id)"
            @revoke="revokeDevice.mutate"
          />
        </div>
        <p v-else class="mx-1 my-0 text-xs text-ink-3">No devices to show.</p>
      </div>
    </template>

    <div
      v-else-if="status?.kind === 'locked'"
      class="status-card flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
    >
      <span
        class="grid size-9 shrink-0 place-items-center rounded-md bg-gold-soft text-gold"
      >
        <Lock :size="17" />
      </span>
      <div class="min-w-0 flex-1">
        <p
          class="status-title m-0 flex items-center gap-1.5 text-sm font-semibold text-ink-1"
        >
          Account locked
        </p>
        <p class="mt-px mb-0 text-xs text-ink-3">{{ status.message }}</p>
        <!-- The lock verdict is re-checked slowly; a re-enabled user needs a
             way back to the form NOW, not at the next daily check. -->
        <button
          type="button"
          class="add-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1 disabled:opacity-55"
          :disabled="signOut.isPending.value"
          @click="signOut.mutate()"
        >
          Sign in again
        </button>
      </div>
    </div>

    <div
      v-else-if="status?.kind === 'offline'"
      class="status-card flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
    >
      <span
        class="grid size-9 shrink-0 place-items-center rounded-md bg-panel text-ink-3"
      >
        <CloudOff :size="17" />
      </span>
      <div class="min-w-0 flex-1">
        <p
          class="status-title m-0 flex items-center gap-1.5 text-sm font-semibold text-ink-1"
        >
          {{ status.displayName ?? "Signed in" }}
          <span
            v-if="status.tier !== null"
            class="tier-chip shrink-0 rounded-full border border-hair-strong px-[7px] text-[10px] font-semibold text-ink-3"
            >{{ tierLabel(status.tier) }}</span
          >
          <span
            v-if="status.email"
            class="text-[11px] font-normal text-ink-3"
            >{{ status.email }}</span
          >
        </p>
        <p class="mt-px mb-0 text-xs text-ink-3">
          Can't reach the hub — will retry automatically.
        </p>
      </div>
    </div>
  </div>
</template>
