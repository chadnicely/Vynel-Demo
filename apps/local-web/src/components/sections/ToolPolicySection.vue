<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronRight, ShieldCheck } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import { useHubFeatures } from "../../composables/hub/use-hub-features.js";
import { useResetToolPolicy } from "../../composables/tool-policies/use-reset-tool-policy.js";
import { useToolPolicies } from "../../composables/tool-policies/use-tool-policies.js";
import type { EffectiveToolPolicy } from "../../composables/tool-policies/tool-policy-contract.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import CapabilityTogglesPanel from "./tool-policy/CapabilityTogglesPanel.vue";
import ToolPolicyEditDialog from "./tool-policy/ToolPolicyEditDialog.vue";
import ToolPolicyRow from "./tool-policy/ToolPolicyRow.vue";
import { asHubFeatureKey } from "./tool-policy/tool-policy-labels.js";
import type { SectionScope } from "./section-scope.js";
import SectionHeader from "./SectionHeader.vue";

// The Tool Policy admin matrix — every tool the daemon composes, grouped by
// its MCP server and wearing its EFFECTIVE policy (declared defaults merged
// with the user's overrides). The matrix is machine-level (user-scoped) and
// identical on both surfaces; the workspace surface adds its own capability
// switches above it.
const props = defineProps<{
  scope: SectionScope;
}>();

const policiesQuery = useToolPolicies();
const tools = computed(() => policiesQuery.data.value ?? []);

interface ServerGroup {
  serverName: string;
  tools: EffectiveToolPolicy[];
}

// Group by serverName preserving the catalog's response order — the backend
// resolves from the declared catalog, whose order is deliberate.
const serverGroups = computed<ServerGroup[]>(() => {
  const groups: ServerGroup[] = [];
  const byName = new Map<string, ServerGroup>();
  for (const tool of tools.value) {
    let group = byName.get(tool.serverName);
    if (group === undefined) {
      group = { serverName: tool.serverName, tools: [] };
      byName.set(tool.serverName, group);
      groups.push(group);
    }
    group.tools.push(tool);
  }
  return groups;
});

// Groups open by default (tracking absence needs no init step when data lands).
const collapsedServers = ref<ReadonlySet<string>>(new Set());

function toggleServer(serverName: string) {
  const next = new Set(collapsedServers.value);
  if (next.has(serverName)) next.delete(serverName);
  else next.add(serverName);
  collapsedServers.value = next;
}

// Tier gating is display-only here: a locked row greys out, mirroring the
// daemon's enforcement, but its policy stays editable.
const { isLocked } = useHubFeatures();

function isTierLocked(tool: EffectiveToolPolicy): boolean {
  const featureKey = asHubFeatureKey(tool.featureKey);
  return featureKey !== null && isLocked(featureKey);
}

const resetPolicy = useResetToolPolicy();

function isResetting(tool: EffectiveToolPolicy): boolean {
  return (
    resetPolicy.isPending.value &&
    resetPolicy.variables.value === tool.toolName
  );
}

// Edit holds the snapshot deliberately — the form starts from the clicked
// state (the tasks-section idiom).
const editingTool = ref<EffectiveToolPolicy | null>(null);

const errorMessage = computed(() =>
  resetPolicy.error.value ? formatSdkError(resetPolicy.error.value) : null,
);

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "Which tools exist, where they attach, and when they card — machine-wide"
    : "Machine-wide tool rules, plus this workspace's capabilities",
);
</script>

<template>
  <div class="tool-policy-section flex flex-col gap-2.5">
    <SectionHeader
      :icon="ShieldCheck"
      title="Tool Policy"
      :subtitle="sectionHint"
    />

    <CapabilityTogglesPanel
      v-if="props.scope.kind === 'workspace'"
      :workspace-id="props.scope.workspaceId"
    />
    <p v-else class="capabilities-hint m-0 text-[11px] text-ink-3">
      Capabilities are switched per workspace — open a workspace's Tool Policy
      section to toggle them.
    </p>

    <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
      {{ errorMessage }}
    </p>

    <div v-if="serverGroups.length > 0" class="groups flex flex-col gap-3">
      <div
        v-for="group in serverGroups"
        :key="group.serverName"
        class="server-group"
      >
        <button
          type="button"
          class="group-toggle inline-flex cursor-default items-center gap-1 rounded-md px-1 py-0.5 text-xs font-semibold text-ink-3 transition hover:text-ink-1"
          :aria-expanded="!collapsedServers.has(group.serverName)"
          @click="toggleServer(group.serverName)"
        >
          <ChevronRight
            :size="13"
            class="transition-transform"
            :class="{ 'rotate-90': !collapsedServers.has(group.serverName) }"
          />
          <span class="font-mono">{{ group.serverName }}</span>
          · {{ group.tools.length }}
        </button>
        <div
          v-if="!collapsedServers.has(group.serverName)"
          class="rows mt-2 flex flex-col gap-2"
        >
          <ToolPolicyRow
            v-for="tool in group.tools"
            :key="tool.toolName"
            :tool="tool"
            :tier-locked="isTierLocked(tool)"
            :reset-pending="isResetting(tool)"
            @edit="editingTool = tool"
            @reset="resetPolicy.mutate(tool.toolName)"
          />
        </div>
      </div>
    </div>

    <EmptyState
      v-else
      title="No tools reported"
      hint="Every tool Claude can call shows here with its policy — the list fills in once the local service reports its tool catalog."
    >
      <template #icon>
        <ShieldCheck :size="22" />
      </template>
    </EmptyState>

    <ToolPolicyEditDialog
      :open="editingTool !== null"
      :tool="editingTool"
      @close="editingTool = null"
    />
  </div>
</template>
