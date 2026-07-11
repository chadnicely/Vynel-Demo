<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import type { HubItemKind } from "@vynel/contracts/hub/catalog";
import KindChip from "../components/catalog/KindChip.vue";
import StatusChip from "../components/catalog/StatusChip.vue";
import { useAdminCatalog } from "../composables/catalog/use-admin-catalog.js";
import { formatDate } from "../lib/format.js";

const KIND_TABS = ["all", "skill", "agent", "mcp", "rule", "plugin"] as const;
type KindTab = (typeof KIND_TABS)[number];

const router = useRouter();
const catalogQuery = useAdminCatalog();
const activeKind = ref<KindTab>("all");

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
      <RouterLink
        class="button button-primary"
        :to="{ name: 'catalog-publish' }"
      >
        Publish item
      </RouterLink>
    </header>
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
        The catalog is empty — use the "Publish item" button above to publish
        the first one.
      </template>
    </p>
    <table v-else class="catalog-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Item id</th>
          <th>Kind</th>
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
