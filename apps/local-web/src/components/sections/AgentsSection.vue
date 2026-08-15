<script setup lang="ts">
import { computed } from "vue";
import { PhRobot as Bot } from "@phosphor-icons/vue";
import { EmptyState } from "@vynel/ui";
import { useAgents } from "../../composables/agents/use-agents.js";
import { useSetAgentEnabled } from "../../composables/agents/use-set-agent-enabled.js";
import { useScopeLabel } from "../../composables/workspaces/use-scope-label.js";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";

// The agents section, on either surface: the global menu shows the user-scope
// specialists (available in every workspace); a workspace drawer shows the
// ones added to THAT room. Its sessions can still delegate to the global ones
// — the "@" picker reads the resolved union — but this shelf is what the room
// owns, so nothing here manages a global agent. Every source appears — curated
// installs,
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

// The workspace wording says "added here" rather than "it can delegate to":
// this shelf is what the room OWNS, and a session here can also delegate to
// every global agent above it.
const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "Specialists Claude can delegate to, in every workspace"
    : "Specialists added to this workspace",
);
</script>

<template>
  <div class="agents-section flex flex-col gap-2.5">
    <SectionHeader :icon="Bot" title="Agents" :subtitle="sectionHint" />

    <div v-if="agents.length > 0" class="rows flex flex-col gap-2">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="row group flex items-center gap-3 rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong hover:shadow-raised"
      >
        <span
          class="row-icon grid size-9 shrink-0 place-items-center rounded-md bg-ok/10 text-ok"
        >
          <Bot :size="17" />
        </span>
        <div class="row-main min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
              {{ agent.name }}
            </p>
            <span
              v-if="SOURCE_LABELS[agent.source]"
              class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
            >
              {{ SOURCE_LABELS[agent.source] }}
            </span>
            <span
              class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
              >{{ scopeLabel(agent.workspaceId) }}</span
            >
          </div>
          <p class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
            {{ agent.description }}
          </p>
        </div>
        <button
          type="button"
          class="pill shrink-0 cursor-default rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
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
