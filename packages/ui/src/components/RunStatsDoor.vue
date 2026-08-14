<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import Tooltip from "./Tooltip.vue";

// The canvas puts a small info glyph at the head of every reply line. That
// slot is also the only place a run's metadata belongs, so the glyph IS the
// door: with stats it opens the hover card, without them it stays the quiet
// mark the canvas draws.
const props = withDefaults(
  defineProps<{
    stats?: ChatMessageResponse["runStats"] | null;
    /** True when the stats came from the ROW (a delivered colleague's own
     *  run) rather than the host's turn aggregate — only a served run knows
     *  that a null duration means "still going". */
    served?: boolean;
  }>(),
  { stats: null, served: false },
);

function formatTokenCount(count: number): string {
  return count >= 1000
    ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`
    : String(count);
}

function formatRunDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

// "Tokens" is what the run/turn ADDED: fresh input (the occupancy delta the
// host/server derived) + generated output. The window total rides separately
// as the Context row — the two must never read as one number again (the
// "462.8k in" confusion).
const tokensLabel = computed(() => {
  const stats = props.stats;
  if (!stats) return null;
  if (stats.inputTokens === null && stats.outputTokens === null) return "—";
  const inPart =
    stats.inputTokens === null
      ? "—"
      : `+${formatTokenCount(stats.inputTokens)}`;
  return `${inPart} in · ${formatTokenCount(stats.outputTokens ?? 0)} out`;
});

const contextLabel = computed(() => {
  const contextTokens = props.stats?.contextTokens ?? null;
  return contextTokens === null ? "—" : formatTokenCount(contextTokens);
});

// SERVED stats know a null duration means the run hasn't finished; a turn
// aggregate's null just means timestamps are missing (an interrupted or
// legacy turn) — claiming "still running" there would lie.
const durationLabel = computed(() => {
  const durationMs = props.stats?.durationMs ?? null;
  if (durationMs !== null) return formatRunDuration(durationMs);
  return props.served ? "still running" : "—";
});
</script>

<template>
  <Tooltip v-if="props.stats" side="bottom" :delay-ms="150">
    <template #content>
      <span class="stats-card">
        <span class="stats-row">
          <span class="stats-key">Model</span>
          <span>{{ props.stats.model ?? "default" }}</span>
        </span>
        <span class="stats-row">
          <span class="stats-key">Tool calls</span>
          <span>{{ props.stats.toolCallCount }}</span>
        </span>
        <span class="stats-row">
          <span class="stats-key">Tokens</span>
          <span>{{ tokensLabel }}</span>
        </span>
        <span class="stats-row">
          <span class="stats-key">Context</span>
          <span>{{ contextLabel }}</span>
        </span>
        <span class="stats-row">
          <span class="stats-key">Took</span>
          <span>{{ durationLabel }}</span>
        </span>
      </span>
    </template>
    <span class="lead-glyph run-info" aria-label="run details">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.3" />
        <path
          d="M8 7.4v3.1M8 5.3v.2"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        />
      </svg>
    </span>
  </Tooltip>
  <span v-else class="lead-glyph" aria-hidden="true">
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.3" />
      <path
        d="M8 7.4v3.1M8 5.3v.2"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  </span>
</template>

<style scoped>
.lead-glyph {
  display: inline-flex;
  flex: none;
  color: var(--ink-3);
}

.run-info:hover {
  color: var(--ink-1);
}

/* Teleported with the tooltip, but it keeps this component's scope. */
.stats-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 150px;
  padding: 3px 4px;
}

.stats-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--ink-1);
  font: 400 11.5px/1.6 var(--font-ui);
}

.stats-key {
  color: var(--ink-3);
}
</style>
