<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import type { HubItemKind } from "@vynel/contracts/hub/catalog";
import KindChip from "../components/catalog/KindChip.vue";
import StatusChip from "../components/catalog/StatusChip.vue";
import { useAdminCatalog } from "../composables/catalog/use-admin-catalog.js";
import { useImportAnthropic } from "../composables/catalog/use-import-anthropic.js";
import { useUpstreamWatch } from "../composables/catalog/use-upstream-watch.js";
import { formatDate } from "../lib/format.js";

const KIND_TABS = ["all", "skill", "agent", "mcp", "rule", "plugin"] as const;
type KindTab = (typeof KIND_TABS)[number];

const router = useRouter();
const catalogQuery = useAdminCatalog();
const activeKind = ref<KindTab>("all");

// The hub's daily upstream-drift check — a banner only when Anthropic's
// repo moved past our pin in a folder we republish (curation nudge, never
// an auto-update).
// One-click server-side publish of the pinned anthropic-catalog manifest —
// idempotent, so re-clicks just report "skipped".
const importMutation = useImportAnthropic();
const importSummary = computed(() => {
  const response = importMutation.data.value;
  if (!response) return null;
  if (!response.configured) {
    return "The hub runs without the anthropic-catalog manifest — nothing to import.";
  }
  const published =
    response.items?.filter((item) => item.outcome === "published").length ?? 0;
  const skipped = (response.items?.length ?? 0) - published;
  return `Import finished: ${published} published · ${skipped} skipped (already current).`;
});

const upstreamQuery = useUpstreamWatch();
const upstreamDrift = computed(() => {
  const report = upstreamQuery.data.value?.report;
  if (!report || report.movedCount === 0) return null;
  return {
    movedCount: report.movedCount,
    total: report.items.length,
    movedIds: report.items.filter((i) => i.changed).map((i) => i.itemId),
    pin: report.pinnedSha.slice(0, 7),
    head: report.upstreamHeadSha.slice(0, 7),
  };
});

const filteredItems = computed(() => {
  const items = catalogQuery.data.value ?? [];
  if (activeKind.value === "all") return items;
  return items.filter((item) => item.kind === activeKind.value);
});

function latestVersion(versions: { version: string }[]): string {
  // Versions arrive newest-first (the admin DTO contract).
  return versions[0]?.version ?? "—";
}

function openItem(itemId: string) {
  void router.push({ name: "catalog-item", params: { itemId } });
}

function isKind(tab: KindTab): tab is HubItemKind {
  return tab !== "all";
}
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">Catalog</h1>
      <div class="page-actions">
        <button
          type="button"
          class="button"
          :disabled="importMutation.isPending.value"
          @click="importMutation.mutate()"
        >
          {{ importMutation.isPending.value ? "Importing…" : "Import Anthropic items" }}
        </button>
        <RouterLink
          class="button button-primary"
          :to="{ name: 'catalog-publish' }"
        >
          Add Marketplace Catalog
        </RouterLink>
      </div>
    </header>
    <p v-if="importMutation.isError.value" class="form-error">
      Import failed: {{ importMutation.error.value?.message }}
    </p>
    <p v-else-if="importSummary" class="muted-note">{{ importSummary }}</p>
    <p v-if="upstreamDrift" class="drift-banner">
      Anthropic's upstream moved past our pin ({{ upstreamDrift.pin }} →
      {{ upstreamDrift.head }}): {{ upstreamDrift.movedCount }} of
      {{ upstreamDrift.total }} republished item(s) changed —
      {{ upstreamDrift.movedIds.join(", ") }}. Review and re-pin via
      <code>pnpm cloud:import-anthropic</code>.
    </p>
    <div class="kind-tabs" role="tablist">
      <button
        v-for="tab in KIND_TABS"
        :key="tab"
        type="button"
        role="tab"
        class="kind-tab"
        :aria-selected="activeKind === tab"
        @click="activeKind = tab"
      >
        {{ tab }}
      </button>
    </div>

    <p v-if="catalogQuery.isPending.value" class="muted-note">
      Loading the catalog…
    </p>
    <div v-else-if="catalogQuery.isError.value" class="card">
      <p class="form-error">
        {{ catalogQuery.error.value?.message }}
      </p>
      <button type="button" class="button" @click="catalogQuery.refetch()">
        Retry
      </button>
    </div>
    <p v-else-if="filteredItems.length === 0" class="muted-note">
      <template v-if="isKind(activeKind)">
        No {{ activeKind }} items yet.
      </template>
      <template v-else>
        The catalog is empty — use the "Add Marketplace Catalog" button above
        to publish the first one.
      </template>
    </p>
    <table v-else class="catalog-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Item id</th>
          <th>Kind</th>
          <th>Publisher</th>
          <th>Status</th>
          <th>Min tier</th>
          <th>Latest</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in filteredItems"
          :key="item.itemId"
          class="catalog-row"
          @click="openItem(item.itemId)"
        >
          <td>{{ item.displayName }}</td>
          <td class="mono">{{ item.itemId }}</td>
          <td><KindChip :kind="item.kind" /></td>
          <td>{{ item.publisherName }}</td>
          <td><StatusChip :status="item.status" /></td>
          <td>{{ item.minimumTier }}</td>
          <td class="mono">{{ latestVersion(item.versions) }}</td>
          <td>{{ formatDate(item.updatedAt) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-title {
  font-size: 17px;
  margin: 0;
}

.page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drift-banner {
  margin: 0 0 12px;
  padding: 8px 12px;
  border: 1px solid var(--warn, #b58900);
  border-radius: var(--radius-s);
  color: var(--ink-1);
  background: color-mix(in srgb, var(--warn, #b58900) 12%, transparent);
  font-size: 12.5px;
}

.kind-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
}

.kind-tab {
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  color: var(--ink-2);
  font: inherit;
  padding: 4px 10px;
  cursor: pointer;
  text-transform: capitalize;
}

.kind-tab:hover {
  background: var(--row-hover);
}

.kind-tab[aria-selected="true"] {
  background: var(--row-active);
  border-color: var(--hair-strong);
  color: var(--ink-1);
}

.catalog-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th {
  text-align: left;
  color: var(--ink-3);
  font-weight: 500;
  font-size: 12px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--hair-strong);
}

td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--hair);
}

.catalog-row {
  cursor: pointer;
}

.catalog-row:hover {
  background: var(--row-hover);
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
}
</style>
