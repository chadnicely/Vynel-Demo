<script setup lang="ts">
import { computed } from "vue";
import { Bot } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useAgents } from "../../composables/agents/use-agents.js";
import { useSetAgentEnabled } from "../../composables/agents/use-set-agent-enabled.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";

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
  <div class="agents-section flex flex-col gap-2.5">
    <SectionHeader :icon="Bot" title="Agents" :subtitle="sectionHint" />

    <div v-if="agents.length > 0" class="rows flex flex-col gap-1">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="row flex items-center gap-2.5 rounded-sm border border-hair bg-raised px-2.5 py-2"
      >
        <span
          class="row-icon grid size-[26px] shrink-0 place-items-center rounded-sm border border-hair bg-panel text-ink-2"
        >
          <Bot :size="14" />
        </span>
        <div class="row-main min-w-0 flex-1">
          <p
            class="row-title m-0 flex items-center gap-1.5 text-sm font-medium text-ink-1"
          >
            {{ agent.name }}
            <span
              v-if="SOURCE_LABELS[agent.source]"
              class="scope-chip inline-flex items-center gap-0.5 rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
            >
              {{ SOURCE_LABELS[agent.source] }}
            </span>
            <span
              class="scope-chip inline-flex items-center gap-0.5 rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ scopeLabel(agent.workspaceId) }}</span
            >
          </p>
          <p class="row-sub m-0 mt-px truncate text-xs text-ink-3">
            {{ agent.description }}
          </p>
        </div>
        <button
          type="button"
          class="pill shrink-0 cursor-default rounded-full px-2.5 py-px text-[11px] font-semibold"
          :class="
            agent.enabled
              ? 'is-on bg-ok/15 text-ok'
              : 'is-off bg-row-active text-ink-3'
          "
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
