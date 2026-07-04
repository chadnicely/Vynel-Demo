<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatToolCallResponse } from "@vynel/contracts/chat/chat-http";
import { groupConsecutiveToolCalls } from "../tool-cards/group-tool-calls.js";
import { describeToolCallGroup } from "../tool-cards/tool-presenters.js";
import ToolCallCard from "./ToolCallCard.vue";
import PresenceDot from "./PresenceDot.vue";

// Renders a message's tool activity: consecutive same-tool runs collapse
// under one header ("Read 2 files"), single calls render as plain cards.
const props = defineProps<{ toolCalls: ChatToolCallResponse[] }>();

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
      <ToolCallCard v-if="group.length === 1" :tool-call="group[0]!" />

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
          <ToolCallCard
            v-for="toolCall in group"
            :key="toolCall.id"
            :tool-call="toolCall"
          />
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
</style>
