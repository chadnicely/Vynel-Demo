<script setup lang="ts">
import { AgentActivityPane, MarkdownText } from "@vynel/ui";
import type { AgentFocus } from "./agent-focus.js";

// One agent's focused body (the panel's agent-node view): the full activity
// pane (live map first, persisted subagent fields after settle), then the
// final report — with honest states for every gap (still running, finished
// without a report, not recorded yet).
const props = defineProps<{
  focus: AgentFocus;
}>();
</script>

<template>
  <div class="agent-focus">
    <AgentActivityPane
      v-if="props.focus.activity"
      class="agent-focus-activity"
      :activity="props.focus.activity"
    />
    <p v-else-if="props.focus.call?.status === 'started'" class="state-note">
      The agent is working — its live activity appears here while it runs.
    </p>
    <div v-if="props.focus.report" class="agent-report">
      <MarkdownText :source="props.focus.report" />
    </div>
    <p
      v-else-if="props.focus.call !== null && props.focus.call.status !== 'started'"
      class="state-note"
    >
      The agent finished — no report was captured for this run.
    </p>
    <p v-else-if="props.focus.call === null" class="state-note">
      This agent's run isn't in the trace yet — it appears as the workspace
      records it.
    </p>
  </div>
</template>

<style scoped>
.agent-focus {
  display: grid;
  gap: 12px;
}

/* Full-pane variant of the nested pane — no indent rail needed here. */
.agent-focus-activity {
  margin-left: 0;
  border-left: 0;
  padding-left: 0;
}

.agent-report {
  border-top: 1px solid var(--hair);
  padding-top: 12px;
}

.state-note {
  margin: 16px 0 0;
  text-align: center;
  color: var(--ink-3);
  font: 400 12.5px/1.6 var(--font-ui);
}
</style>
