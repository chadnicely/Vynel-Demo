<script setup lang="ts">
import { computed, ref } from "vue";
import { TOOL_CATALOG_SNAPSHOT } from "@vynel/contracts/generated/tool-catalog-snapshot";
import ToolPolicyEditForm from "../components/tool-policy/ToolPolicyEditForm.vue";
import {
  groupToolsByServer,
  shortToolName,
  snapshotCapabilityIds,
  type EffectiveToolRow,
} from "../components/tool-policy/effective-tool-policy.js";
import { useResetToolPolicyDefault } from "../composables/tool-policy/use-reset-tool-policy-default.js";
import { useToolPolicyDefaults } from "../composables/tool-policy/use-tool-policy-defaults.js";
import { useToolPolicyMap } from "../composables/tool-policy/use-tool-policy-map.js";
import { formatDate } from "../lib/format.js";

const defaultsQuery = useToolPolicyDefaults();
const mapQuery = useToolPolicyMap();
const resetMutation = useResetToolPolicyDefault();

const nameFilter = ref("");
const expandedTool = ref<string | null>(null);

const capabilityIds = snapshotCapabilityIds(TOOL_CATALOG_SNAPSHOT);

const groups = computed(() => {
  const grouped = groupToolsByServer(
    TOOL_CATALOG_SNAPSHOT,
    defaultsQuery.data.value ?? [],
  );
  const needle = nameFilter.value.trim().toLowerCase();
  if (needle === "") return grouped;
  return grouped
    .map((group) => ({
      serverName: group.serverName,
      rows: group.rows.filter((row) =>
        row.entry.toolName.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.rows.length > 0);
});

// What a release build would bake right now — the header's provenance line.
const mapStamp = computed(() => {
  const map = mapQuery.data.value;
  if (!map) return null;
  return {
    version: map.version.slice(0, 12),
    generatedAt: formatDate(map.generatedAt),
  };
});

function toggleEdit(toolName: string) {
  expandedTool.value = expandedTool.value === toolName ? null : toolName;
}

function resetOverride(row: EffectiveToolRow) {
  resetMutation.mutate(row.entry.toolName);
}

function surfacesTitle(row: EffectiveToolRow): string {
  return row.effective.surfaces.join(", ");
}
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">Tool policy</h1>
      <span v-if="mapStamp" class="map-stamp">
        map <span class="mono">{{ mapStamp.version }}</span> · generated
        {{ mapStamp.generatedAt }}
      </span>
    </header>

    <input
      v-model="nameFilter"
      class="text-input filter-input"
      type="search"
      placeholder="Filter by tool name…"
    />

    <p v-if="resetMutation.isError.value" class="form-error">
      Reset failed: {{ resetMutation.error.value?.message }}
    </p>

    <p v-if="defaultsQuery.isPending.value" class="muted-note">
      Loading the hub's overrides…
    </p>
    <div v-else-if="defaultsQuery.isError.value" class="card">
      <p class="form-error">
        {{ defaultsQuery.error.value?.message }}
      </p>
      <button type="button" class="button" @click="defaultsQuery.refetch()">
        Retry
      </button>
    </div>
    <p v-else-if="groups.length === 0" class="muted-note">
      No tools match "{{ nameFilter }}".
    </p>
    <template v-else>
      <section
        v-for="group in groups"
        :key="group.serverName"
        class="server-group"
      >
        <h2 class="server-name">
          {{ group.serverName }}
          <span class="server-count">{{ group.rows.length }} tools</span>
        </h2>
        <table class="policy-table">
          <tbody>
            <template v-for="row in group.rows" :key="row.entry.toolName">
              <tr
                class="policy-row"
                :class="{ 'policy-row-off': !row.effective.enabled }"
                @click="toggleEdit(row.entry.toolName)"
              >
                <td class="tool-cell mono" :title="row.entry.toolName">
                  {{ shortToolName(row.entry.toolName) }}
                </td>
                <td>
                  <span v-if="!row.effective.enabled" class="chip chip-off">
                    off
                  </span>
                </td>
                <td>
                  <span class="chip">{{ row.effective.cardClass }}</span>
                </td>
                <td :title="surfacesTitle(row)">
                  {{ row.effective.surfaces.length }} surfaces
                </td>
                <td class="gates-cell">
                  <span v-if="row.effective.featureKey" class="chip">
                    feature: {{ row.effective.featureKey }}
                  </span>
                  <span v-if="row.effective.capabilityId" class="chip">
                    cap: {{ row.effective.capabilityId }}
                  </span>
                </td>
                <td class="actions-cell" @click.stop>
                  <template v-if="row.override !== null">
                    <span class="chip chip-customized">customized</span>
                    <button
                      type="button"
                      class="button reset-button"
                      :disabled="resetMutation.isPending.value"
                      @click="resetOverride(row)"
                    >
                      Reset
                    </button>
                  </template>
                </td>
              </tr>
              <tr v-if="expandedTool === row.entry.toolName">
                <td colspan="6">
                  <ToolPolicyEditForm
                    :key="row.entry.toolName"
                    :row="row"
                    :capability-ids="capabilityIds"
                    @close="expandedTool = null"
                  />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}

.page-title {
  font-size: 17px;
  margin: 0;
}

.map-stamp {
  font-size: 12px;
  color: var(--ink-3);
}

.filter-input {
  max-width: 320px;
  margin-bottom: 16px;
}

.server-group {
  margin-bottom: 20px;
}

.server-name {
  font-size: 13px;
  font-family: var(--font-mono);
  margin: 0 0 6px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.server-count {
  font-size: 11.5px;
  font-family: var(--font-sans, inherit);
  color: var(--ink-3);
  font-weight: 400;
}

.policy-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--hair);
}

.policy-row {
  cursor: pointer;
}

.policy-row:hover {
  background: var(--row-hover);
}

.policy-row-off {
  color: var(--ink-3);
}

.tool-cell {
  width: 32%;
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
}

.chip {
  display: inline-block;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 11px;
  font-family: var(--font-mono);
  border: 1px solid var(--hair-strong);
  background: var(--bg-raised);
  color: var(--ink-2);
}

.chip-off {
  border-color: var(--warn, #b58900);
  color: var(--warn, #b58900);
}

.chip-customized {
  border-color: var(--hair-strong);
  color: var(--ink-1);
}

.gates-cell .chip {
  margin-right: 4px;
}

.actions-cell {
  text-align: right;
  white-space: nowrap;
}

.reset-button {
  padding: 2px 8px;
  font-size: 11.5px;
  margin-left: 6px;
}
</style>
