<script setup lang="ts">
import { computed, ref } from "vue";
import { Monitor, X } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useDesktopAccess } from "../../composables/desktop-access/use-desktop-access.js";
import { useRevokeDesktopAccess } from "../../composables/desktop-access/use-revoke-desktop-access.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import SectionHeader from "./SectionHeader.vue";

// The desktop-access management surface — machine-level, global-only. This
// section can only SEE and REVOKE: grants are created exclusively by the user
// approving a request card mid-turn (the consent moment), so there is no
// "add" button by design.

const grantsQuery = useDesktopAccess(true);
const grants = computed(() => grantsQuery.data.value ?? []);

const TIER_LABELS: Record<string, string> = {
  read: "Look only",
  click: "Look + click",
  full: "Look, click + type",
};

const revokeAccess = useRevokeDesktopAccess();
// Hover-reveal two-step (the SshServerRow idiom): revoking mid-task stops
// Claude's hands in that app, so one stray click must never do it.
const armedAppName = ref<string | null>(null);

function requestRevoke(appName: string) {
  if (armedAppName.value !== appName) {
    armedAppName.value = appName;
    return;
  }
  armedAppName.value = null;
  revokeAccess.mutate({ appName });
}
</script>

<template>
  <div class="desktop-access-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="Monitor"
      title="Desktop access"
      subtitle="The apps Claude may see or control on this computer — you approve each one"
    />

    <div v-if="grants.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="grant in grants"
        :key="grant.id"
        class="row group flex items-center gap-3 rounded-xl border border-hair bg-raised px-3.5 py-2.5"
        @mouseleave="armedAppName === grant.appName && (armedAppName = null)"
      >
        <Monitor :size="16" class="shrink-0 text-ink-3" />
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-[13px] font-semibold capitalize text-ink-1">{{
            grant.appName
          }}</span>
          <span class="text-xs text-ink-3"
            >Granted {{ formatRelativeTime(grant.createdAt) }}</span
          >
        </div>
        <span
          class="tier-chip shrink-0 rounded-full border border-hair px-2.5 py-[3px] text-[11px] font-semibold text-ink-2"
        >
          {{ TIER_LABELS[grant.tier] ?? grant.tier }}
        </span>
        <button
          type="button"
          class="revoke-button inline-flex shrink-0 cursor-default items-center gap-1 rounded-full border px-[11px] py-[3px] text-xs font-semibold transition"
          :class="
            armedAppName === grant.appName
              ? 'border-danger/60 bg-danger/10 text-danger'
              : 'border-hair text-ink-3 opacity-0 hover:border-hair-strong hover:text-ink-1 group-hover:opacity-100'
          "
          @click="requestRevoke(grant.appName)"
        >
          <X :size="12" />
          {{ armedAppName === grant.appName ? "Really revoke?" : "Revoke" }}
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      title="No apps granted yet"
      hint="When Claude needs to see or use one of your apps, it takes access one app at a time — in Ask mode you approve each one on a card first; in Auto and Bypass it takes what it needs, since those modes already say yes for you. Whatever it holds shows up here, and you can take any of it back."
    >
      <template #icon>
        <Monitor :size="22" />
      </template>
    </EmptyState>
  </div>
</template>
