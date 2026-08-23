<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PhCheckCircle as CheckCircle,
  PhCircleNotch as CircleNotch,
  PhWarningCircle as WarningCircle,
} from "@phosphor-icons/vue";
import { ClaudeMark, Modal, SegmentedTabs } from "@vynel/ui";
import { useClaudeAuthStatus } from "../../composables/providers/use-claude-auth-status.js";
import { useClaudeRateLimits } from "../../composables/providers/use-claude-rate-limits.js";
import { useUsageStats } from "../../composables/dashboard/use-usage-stats.js";
import {
  buildUsageChartModel,
  formatTokenCount,
} from "../home/model-usage-series.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import ClaudeLoginFlow from "./ClaudeLoginFlow.vue";

// The Claude account popup (top-bar provider mark, 2026-08-18): ONE dialog,
// one functionality — whose subscription this machine runs on. Two tabs:
// Account (who is signed in + the week's token usage, with the sign-in /
// switch flow) and Limits (the /usage-style windows the engine reports as
// turns run). The sign-in itself lives in ClaudeLoginFlow — the engine's CLI
// opens the browser and settles it, never the credential.
const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const TABS = [
  { id: "account", label: "Account" },
  { id: "limits", label: "Limits" },
] as const;
const activeTab = ref<string>("account");

// A fresh dialog per open — land on Account, not wherever last time ended.
watch(
  () => props.open,
  (open) => {
    if (open) activeTab.value = "account";
  },
);

const statusQuery = useClaudeAuthStatus(() => props.open);
const status = computed(() => statusQuery.data.value ?? null);

const planLabel = computed(() => {
  const plan = status.value?.subscriptionPlan;
  if (plan == null) return null;
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;
});

const methodLabel = computed(() =>
  status.value?.authenticationMethod === "api-key" ? "API key" : "Subscription",
);

// The last week's usage, folded per model — the popup wants the totals, not
// the dashboard's chart; same builder, so labels and colors stay one home.
const usageQuery = useUsageStats(() => 7);
const usage = computed(() => {
  const chart = buildUsageChartModel(usageQuery.data.value?.rows ?? [], 7, new Date());
  const totalsByModel = new Map<
    string,
    { label: string; colorVar: string; totalTokens: number }
  >();
  for (const day of chart.days) {
    for (const segment of day.segments) {
      const entry = totalsByModel.get(segment.key) ?? {
        label: segment.label,
        colorVar: segment.colorVar,
        totalTokens: 0,
      };
      entry.totalTokens += segment.totalTokens;
      totalsByModel.set(segment.key, entry);
    }
  }
  return {
    grandTotal: chart.grandTotal,
    models: [...totalsByModel.values()].sort((a, b) => b.totalTokens - a.totalTokens),
  };
});

// ── Limits (the /usage windows) ──────────────────────────────────────────

const limitsQuery = useClaudeRateLimits(() => props.open && activeTab.value === "limits");

// The engine's window vocabulary, in the /usage screen's own words + order.
const WINDOW_PRESENTATION: Record<string, { label: string; order: number }> = {
  five_hour: { label: "Current session", order: 0 },
  seven_day: { label: "Current week (all models)", order: 1 },
  seven_day_opus: { label: "Current week (Opus)", order: 2 },
  seven_day_sonnet: { label: "Current week (Sonnet)", order: 3 },
  seven_day_overage_included: { label: "Extra usage (included)", order: 4 },
  overage: { label: "Extra usage", order: 5 },
};

const limitRows = computed(() => {
  const limits = limitsQuery.data.value?.limits ?? [];
  return limits
    .map((limit) => {
      const presentation = WINDOW_PRESENTATION[limit.windowKind] ?? {
        label: limit.windowKind,
        order: 9,
      };
      const utilization = limit.utilization !== null ? Math.min(100, Math.max(0, limit.utilization)) : null;
      return {
        ...limit,
        label: presentation.label,
        order: presentation.order,
        boundedUtilization: utilization,
        // claude.ai's bar language: red when spent (or the engine rejects),
        // amber when close, quiet accent otherwise.
        tone:
          limit.status === "rejected" || (utilization ?? 0) >= 90
            ? "var(--danger)"
            : limit.status === "allowed_warning" || (utilization ?? 0) >= 75
              ? "var(--warn)"
              : "var(--color-accent)",
      };
    })
    .sort((a, b) => a.order - b.order);
});

const limitsCapturedAt = computed(() => {
  const stamps = (limitsQuery.data.value?.limits ?? []).map((limit) => limit.capturedAt).sort();
  return stamps.at(-1) ?? null;
});

function formatWhen(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Claude account"
    description="The subscription this computer builds with."
    size="md"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-4 pt-1">
      <SegmentedTabs v-model="activeTab" :tabs="[...TABS]" class="self-start" />

      <!-- ── Account ─────────────────────────────────────────────────── -->
      <template v-if="activeTab === 'account'">
        <p v-if="statusQuery.isPending.value" class="quiet-note">
          <CircleNotch :size="13" class="spin" aria-hidden="true" />
          Reading your account…
        </p>
        <p v-else-if="statusQuery.isError.value" class="danger-note">
          {{ formatSdkError(statusQuery.error.value) }}
        </p>

        <template v-else-if="status">
          <!-- Not installed: Vynel ships its own Claude engine, so a missing
               one is a torn install — nothing to sign in to until it's whole. -->
          <p v-if="!status.isInstalled" class="danger-note">
            <WarningCircle :size="14" aria-hidden="true" />
            Vynel's Claude engine is missing from this install, so there is no
            account to sign in. Reinstall Vynel, then come back here.
          </p>

          <!-- Signed in: the account card + the switch door (an expired auth
               or a limit-dodging second subscription — the current account
               stays until the NEW sign-in lands; the CLI only writes on
               completion). -->
          <div v-else-if="status.isAuthenticated" class="flex flex-col gap-3">
            <div class="account-card">
              <span class="account-avatar" aria-hidden="true">
                <ClaudeMark :size="18" />
              </span>
              <span class="account-lines">
                <span class="account-name">
                  {{ status.email ?? status.authenticatedAccountLabel ?? "Claude account" }}
                </span>
                <span v-if="status.organizationName" class="account-detail">
                  {{ status.organizationName }}
                </span>
              </span>
              <span class="account-tags">
                <span class="account-tag is-method">
                  <CheckCircle :size="11" aria-hidden="true" />
                  {{ methodLabel }}
                </span>
                <span v-if="planLabel" class="account-tag">{{ planLabel }}</span>
              </span>
            </div>
            <ClaudeLoginFlow
              idle-label="Switch account or sign in again"
              idle-variant="ghost"
            />
          </div>

          <!-- Signed out: the real sign-in. -->
          <div v-else class="flex flex-col gap-3">
            <p class="quiet-note">
              {{ status.inactiveReason ?? "Not signed in." }}
            </p>
            <ClaudeLoginFlow idle-label="Sign in with your subscription" />
          </div>

          <!-- Usage · last 7 days (self-measured tokens). -->
          <div v-if="status.isAuthenticated" class="usage-block">
            <p class="usage-heading">
              Usage · last 7 days
              <span v-if="usage.grandTotal > 0" class="usage-total">
                {{ formatTokenCount(usage.grandTotal) }} tokens
              </span>
            </p>
            <p v-if="usage.models.length === 0" class="quiet-note">
              Once Claude starts working, token usage lands here.
            </p>
            <ul v-else class="usage-rows">
              <li v-for="model in usage.models" :key="model.label" class="usage-row">
                <span
                  class="usage-dot"
                  :style="{ background: `var(${model.colorVar})` }"
                  aria-hidden="true"
                />
                <span class="usage-model">{{ model.label }}</span>
                <span class="usage-count">
                  {{ formatTokenCount(model.totalTokens) }} tokens
                </span>
              </li>
            </ul>
            <p class="usage-note">
              Counted by Vynel per reply — input includes the conversation
              context each reply reads.
            </p>
          </div>
        </template>
      </template>

      <!-- ── Limits (the /usage windows) ─────────────────────────────── -->
      <template v-else>
        <p v-if="limitsQuery.isPending.value" class="quiet-note">
          <CircleNotch :size="13" class="spin" aria-hidden="true" />
          Reading the limit windows…
        </p>
        <p v-else-if="limitsQuery.isError.value" class="danger-note">
          {{ formatSdkError(limitsQuery.error.value) }}
        </p>
        <p v-else-if="limitRows.length === 0" class="quiet-note">
          No limit readings yet — the engine reports them while Claude works.
          Send any message and check back.
        </p>
        <template v-else>
          <div v-for="limit in limitRows" :key="limit.windowKind" class="limit-row">
            <div class="limit-head">
              <span class="limit-label">{{ limit.label }}</span>
              <span class="limit-percent" :style="{ color: limit.tone }">
                {{
                  limit.boundedUtilization !== null
                    ? `${Math.round(limit.boundedUtilization)}% used`
                    : limit.status === "rejected"
                      ? "Limit reached"
                      : "OK"
                }}
              </span>
            </div>
            <div class="limit-track" aria-hidden="true">
              <div
                class="limit-fill"
                :style="{
                  width: `${limit.boundedUtilization ?? (limit.status === 'rejected' ? 100 : 0)}%`,
                  background: limit.tone,
                }"
              />
            </div>
            <p v-if="formatWhen(limit.resetsAt)" class="limit-resets">
              Resets {{ formatWhen(limit.resetsAt) }}
            </p>
          </div>
          <p class="usage-note">
            As of {{ formatWhen(limitsCapturedAt) ?? "—" }} — readings refresh
            whenever Claude runs a turn on this computer.
          </p>
        </template>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.quiet-note {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-3);
  font: 400 12px/1.6 var(--font-ui);
  text-wrap: pretty;
}

.danger-note {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--danger);
  font: 400 12.5px/1.6 var(--font-ui);
}

.spin {
  animation: dialog-spin 1.1s linear infinite;
  flex: none;
}

@keyframes dialog-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}

/* The prototype's account row, in house tones: avatar chip, name + detail,
   kind/plan tags at the end. */
.account-card {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-panel);
}

.account-avatar {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 9999px;
  background: var(--claude-mark-soft);
  color: var(--claude-mark);
}

.account-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.account-name {
  color: var(--ink-1);
  font: 600 13px/1.4 var(--font-ui);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-detail {
  color: var(--ink-3);
  font: 400 11.5px/1.4 var(--font-ui);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-tags {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}

.account-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border: 1px solid var(--hair-strong);
  border-radius: 999px;
  color: var(--ink-2);
  font: 500 10.5px/1.5 var(--font-ui);
  white-space: nowrap;
}

.account-tag.is-method {
  border-color: color-mix(in srgb, var(--ok) 40%, transparent);
  color: var(--ok);
}

.usage-block {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 3px;
  border-top: 1px solid var(--hair);
}

.usage-heading {
  margin: 6px 0 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--ink-2);
  font: 600 11px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.usage-total {
  margin-left: auto;
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
  text-transform: none;
  letter-spacing: normal;
}

.usage-rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}

.usage-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font: 400 12px/1.6 var(--font-ui);
  color: var(--ink-2);
}

.usage-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.usage-model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-count {
  margin-left: auto;
  color: var(--ink-3);
  white-space: nowrap;
}

.usage-note {
  margin: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
}

/* The claude.ai bar language: label + % on one line, the track below,
   the reset time as the quiet third line. */
.limit-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.limit-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.limit-label {
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
}

.limit-percent {
  margin-left: auto;
  font: 500 11.5px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
}

.limit-track {
  height: 6px;
  border-radius: 999px;
  background: var(--hair);
  overflow: hidden;
}

.limit-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 300ms var(--ease-out);
}

.limit-resets {
  margin: 0;
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}
</style>
