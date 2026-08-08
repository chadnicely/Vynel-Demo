<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import { groupConsecutiveToolCalls } from "../tool-cards/group-tool-calls.js";
import { describeToolCallGroup } from "../tool-cards/tool-presenters.js";
import ToolCallCard from "./ToolCallCard.vue";
import type { AgentActivityLike } from "./AgentActivityPane.vue";
import {
  describeAgentActivityCall,
  deriveSettledAgentActivity,
} from "../tool-cards/subagent-activity.js";
import PresenceDot from "./PresenceDot.vue";

// Renders a message's tool activity: consecutive same-tool runs collapse
// under one header ("Read 2 files"), single calls render as plain cards.
// A RUNNING Agent card shows a one-line live ticker — its latest action
// only, from the host-supplied live map (keyed by the Agent call's
// toolUseId). The full activity never renders in-line (parallel agents must
// not flood the transcript): Watch is the way in, live and after complete
// (the focused view reads the live map or the call's persisted fields).
const props = defineProps<{
  toolCalls: ChatToolCallResponse[];
  agentActivity?: Record<string, AgentActivityLike> | undefined;
  /** Put a "Watch" chip on Agent/Task cards — the host handles `watchAgent`
   *  (opens the focused agent view). */
  watchableAgents?: boolean | undefined;
}>();

const emit = defineEmits<{
  watchAgent: [toolCall: ChatToolCallResponse];
}>();

// NOTE: the dispatch card carries NO delegation chip of its own — the thread
// pointer under the message is the one tracker (Chad, 2026-08-09: the chip
// duplicated the pointer and was retired; the served `delegation` payload now
// feeds the pointer instead).

// The ticker line for a RUNNING Agent card: its latest live action ("Read
// pricing.md"), or a plain working note before the first tool. A mid-run
// reload has no live map yet — the persisted fields carry the latest action
// until the next live event. Settled cards show nothing in-line — Watch
// carries the recorded activity.
function agentTickerFor(toolCall: ChatToolCallResponse): string | null {
  if (toolCall.status !== "started") return null;
  const activity: AgentActivityLike | null =
    props.agentActivity?.[toolCall.toolUseId] ??
    deriveSettledAgentActivity(toolCall);
  if (!activity) return null;
  const latestCall = activity.toolCalls.at(-1);
  return latestCall ? describeAgentActivityCall(latestCall) : "Working…";
}

function isWatchableAgent(toolCall: ChatToolCallResponse): boolean {
  return (
    props.watchableAgents === true &&
    (toolCall.toolName === "Agent" || toolCall.toolName === "Task")
  );
}

const groups = computed(() => groupConsecutiveToolCalls(props.toolCalls));

// Group open/closed state keyed by the group's first call id, open by default.
const closedGroupIds = ref(new Set<string>());

function isGroupOpen(group: ChatToolCallResponse[]): boolean {
  return !closedGroupIds.value.has(group[0]!.id);
}

function toggleGroup(group: ChatToolCallResponse[]) {
  const key = group[0]!.id;
  const next = new Set(closedGroupIds.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  closedGroupIds.value = next;
}

function groupHasRunning(group: ChatToolCallResponse[]): boolean {
  return group.some((toolCall) => toolCall.status === "started");
}
</script>

<template>
  <div class="tool-call-list">
    <template v-for="group in groups" :key="group[0]!.id">
      <template v-if="group.length === 1">
        <ToolCallCard
          :tool-call="group[0]!"
          :watchable="isWatchableAgent(group[0]!)"
          @watch="emit('watchAgent', group[0]!)"
        />
        <p v-if="agentTickerFor(group[0]!)" class="agent-ticker">
          <PresenceDot state="live" />
          <span class="ticker-text">{{ agentTickerFor(group[0]!) }}</span>
        </p>
      </template>

      <div v-else class="tool-group">
        <button
          type="button"
          class="group-header"
          :aria-expanded="isGroupOpen(group)"
          @click="toggleGroup(group)"
        >
          <!-- Inline chevron keeps @vynel/ui icon-library-free (module-notes rule) -->
          <svg
            class="chevron"
            :class="{ 'is-open': isGroupOpen(group) }"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="group-label">
            {{ describeToolCallGroup(group[0]!.toolName, group.length) }}
          </span>
          <PresenceDot
            v-if="groupHasRunning(group)"
            state="live"
            label="tools running"
          />
        </button>
        <div v-if="isGroupOpen(group)" class="group-body">
          <template v-for="toolCall in group" :key="toolCall.id">
            <ToolCallCard
              :tool-call="toolCall"
              :watchable="isWatchableAgent(toolCall)"
              @watch="emit('watchAgent', toolCall)"
            />
            <p v-if="agentTickerFor(toolCall)" class="agent-ticker">
              <PresenceDot state="live" />
              <span class="ticker-text">{{ agentTickerFor(toolCall) }}</span>
            </p>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tool-call-list {
  display: grid;
  gap: 6px;
}

.tool-group {
  display: grid;
  gap: 6px;
}

.group-header {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 2px 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  color: var(--ink-2);
  font: 500 12px/1.5 var(--font-ui);
  cursor: default;
  border-radius: var(--radius-s);
  width: fit-content;
}

.group-header:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.group-header:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -2px;
}

.chevron {
  flex: none;
  transition: transform var(--t-fast) var(--ease-out);
}

.chevron.is-open {
  transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
  .chevron {
    transition: none;
  }
}

.group-body {
  display: grid;
  gap: 6px;
  padding-left: 14px;
  border-left: 1px solid var(--hair);
}

/* A running agent's one-line live ticker — its latest action, nothing more.
   Full detail lives behind the card's Watch chip. */
.agent-ticker {
  margin: 0 0 0 10px;
  padding: 2px 10px 2px 12px;
  border-left: 2px solid var(--hair-strong);
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-2);
  font: 500 12px/1.5 var(--font-mono);
}

/* Its own flex item so the ellipsis actually renders on overflow. */
.ticker-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
