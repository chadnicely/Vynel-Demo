<script setup lang="ts">
import { PresenceDot, workspaceAccentVar } from "@vynel/ui";

// The "working…" strip above the composer: one live chip per in-flight
// delegation (workspace- AND session-target — the creator's conversation sees
// every routed job it's waiting on) plus the origin note for a background turn.
// Each keyed chip opens the SAME trace panel the report's Watch chip does —
// openTrace works regardless of the job's target kind (the trace is keyed by
// partialSessionId, not by where the turn runs).

/** The slice of an in-flight delegation row the banner needs — structural over
 *  the generated `root.listDelegations` DTO. */
export interface InFlightDelegationChip {
  partialSessionId: string | null;
  workspaceName: string;
  /** The spawned target session's display name — null for workspace targets. */
  sessionName: string | null;
  taskLabel: string;
}

const props = defineProps<{
  delegations: InFlightDelegationChip[];
  /** A non-delegation background turn's origin note ("Replying on Telegram…"). */
  backgroundTurnLabel: string | null;
}>();

const emit = defineEmits<{
  /** Watch this delegation — open its live trace panel. */
  watch: [partialSessionId: string];
  /** The user's Stop on this delegation. */
  stop: [partialSessionId: string];
}>();

/** Who the work runs in: the spawned session's name for a session-target job
 *  (the tick attributes the reply to the same name), else the workspace. */
function targetName(delegation: InFlightDelegationChip): string {
  return delegation.sessionName ?? delegation.workspaceName;
}

/** The chip names the actual work — "vynel · Set up the login page" — falling
 *  back to the generic line when the task text was empty. */
function chipLabel(delegation: InFlightDelegationChip): string {
  return delegation.taskLabel
    ? `${targetName(delegation)} · ${delegation.taskLabel}`
    : `Working in ${targetName(delegation)}…`;
}
</script>

<template>
  <div
    v-if="props.delegations.length > 0 || props.backgroundTurnLabel"
    class="processing-banner"
  >
    <span v-if="props.backgroundTurnLabel" class="processing-chip is-static">
      <PresenceDot state="live" />
      <span>{{ props.backgroundTurnLabel }}</span>
    </span>
    <template
      v-for="(delegation, index) in props.delegations"
      :key="delegation.partialSessionId ?? `in-flight-${index}`"
    >
      <span
        v-if="delegation.partialSessionId"
        class="processing-chip"
        :style="{ '--accent': workspaceAccentVar(targetName(delegation)) }"
      >
        <button
          type="button"
          class="processing-chip-main"
          @click="emit('watch', delegation.partialSessionId)"
        >
          <PresenceDot state="live" />
          <span class="processing-chip-label">{{ chipLabel(delegation) }}</span>
          <span class="processing-chip-cta">Watch</span>
        </button>
        <button
          type="button"
          class="processing-chip-stop"
          :aria-label="`Stop: ${chipLabel(delegation)}`"
          @click="emit('stop', delegation.partialSessionId)"
        >
          <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
          </svg>
        </button>
      </span>
      <span v-else class="processing-chip is-static">
        <PresenceDot state="live" />
        <span class="processing-chip-label">{{ chipLabel(delegation) }}</span>
      </span>
    </template>
  </div>
</template>

<style scoped>
.processing-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 968px;
  width: 100%;
  margin: 0 auto;
  padding: 4px 24px 8px;
}

/* One pill per in-flight delegation — the live sibling of the report's
   "Watch X" chip (MessageRow .session-link): clicking opens the same trace
   panel while the task is still running. */
.processing-chip {
  appearance: none;
  border: 1px solid
    color-mix(in srgb, var(--accent, var(--gold)) 38%, transparent);
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--accent, var(--gold)) 12%, transparent);
  color: var(--ink-1);
  font: 600 11.5px/1.5 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

/* Task labels can run long — the chip stays one line and ellipsizes. */
.processing-chip-label {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The chip splits into Watch (the body) + Stop (the square) — both plain
   buttons inside the pill so no button ever nests in a button. */
.processing-chip-main {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  font: inherit;
  cursor: default;
}

.processing-chip-stop {
  appearance: none;
  border: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 99px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
}

.processing-chip-stop:hover {
  background: color-mix(in srgb, var(--danger) 15%, transparent);
  color: var(--danger);
}

.processing-chip-stop:focus-visible {
  outline: 2px solid var(--accent, var(--gold));
  outline-offset: 1px;
}

.processing-chip:not(.is-static):hover {
  border-color: var(--accent, var(--gold));
}

.processing-chip.is-static {
  background: transparent;
  border-color: transparent;
  color: var(--ink-2);
  font-weight: 500;
}

.processing-chip-cta {
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
</style>
