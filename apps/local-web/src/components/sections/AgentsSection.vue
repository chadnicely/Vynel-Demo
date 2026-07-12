<script setup lang="ts">
import { computed } from "vue";
import { Bot } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useAgents } from "../../composables/agents/use-agents.js";
import { useSetAgentEnabled } from "../../composables/agents/use-set-agent-enabled.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import type { SectionScope } from "./section-scope.js";

// The agents section, on either surface: the global menu shows the
// user-scope specialists (available in every workspace); a workspace drawer
// shows those plus that room's own. Every source appears — curated installs,
// marketplace (community) installs, and hand-built agents — each wearing a
// provenance chip; the pill toggles whether the session resolver offers it.
const props = defineProps<{
  scope: SectionScope;
}>();

const agentsQuery = useAgents(() => props.scope);
const agents = computed(() => agentsQuery.data.value ?? []);

const { scopeLabel } = useScopeLabel();

// Provenance chip per source. User-built agents wear none — "yours" is the
// default; the chip marks what arrived from elsewhere (marketplace idiom).
const SOURCE_LABELS: Record<string, string> = {
  vynel: "Curated",
  community: "Community",
};

const setEnabled = useSetAgentEnabled();

function toggleAgent(agent: { id: string; enabled: boolean }) {
  setEnabled.mutate({ agentId: agent.id, enabled: !agent.enabled });
}

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "Specialists Claude can delegate to, in every workspace"
    : "Specialists it can delegate to",
);
</script>

<template>
  <div class="agents-section">
    <header class="section-header">
      <Bot :size="15" class="section-icon" />
      <div class="section-text">
        <p class="section-title">Agents</p>
        <p class="section-hint">{{ sectionHint }}</p>
      </div>
    </header>

    <div v-if="agents.length > 0" class="rows">
      <div v-for="agent in agents" :key="agent.id" class="row">
        <span class="row-icon">
          <Bot :size="14" />
        </span>
        <div class="row-main">
          <p class="row-title">
            {{ agent.name }}
            <span v-if="SOURCE_LABELS[agent.source]" class="scope-chip">
              {{ SOURCE_LABELS[agent.source] }}
            </span>
            <span class="scope-chip">{{ scopeLabel(agent.workspaceId) }}</span>
          </p>
          <p class="row-sub">{{ agent.description }}</p>
        </div>
        <button
          type="button"
          class="pill"
          :class="agent.enabled ? 'is-on' : 'is-off'"
          :aria-label="`Turn ${agent.name} ${agent.enabled ? 'off' : 'on'}`"
          @click="toggleAgent(agent)"
        >
          {{ agent.enabled ? "On" : "Off" }}
        </button>
      </div>
    </div>

    <EmptyState
      v-else
      title="No agents yet"
      hint="Install a specialist from the Marketplace and Claude can delegate focused work to it — research, writing, whatever the task calls for."
    >
      <template #icon>
        <Bot :size="22" />
      </template>
    </EmptyState>
  </div>
</template>

<style scoped>
.agents-section {
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

.rows {
  display: grid;
  gap: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
}

.row-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  background: var(--bg-panel);
  color: var(--ink-2);
  flex: none;
}

.row-main {
  min-width: 0;
  flex: 1;
}

.row-title {
  margin: 0;
  color: var(--ink-1);
  font: 500 12.5px/1.5 var(--font-ui);
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-sub {
  margin: 1px 0 0;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scope-chip {
  color: var(--ink-3);
  font: 600 9.5px/1.4 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  padding: 0 6px;
}

/* The On/Off pill is the toggle itself — the schedules-section idiom. */
.pill {
  appearance: none;
  margin: 0;
  border: 0;
  flex: none;
  font: 600 11px/1.6 var(--font-ui);
  border-radius: 99px;
  padding: 1px 10px;
  cursor: default;
}

.pill.is-on {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 14%, transparent);
}

.pill.is-off {
  color: var(--ink-3);
  background: var(--row-active);
}

.pill:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
