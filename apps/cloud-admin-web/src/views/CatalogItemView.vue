<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft } from "lucide-vue-next";
import ItemMetadataForm from "../components/catalog/ItemMetadataForm.vue";
import ItemStatusControl from "../components/catalog/ItemStatusControl.vue";
import ItemVersionsTable from "../components/catalog/ItemVersionsTable.vue";
import KindChip from "../components/catalog/KindChip.vue";
import PublishVersionForm from "../components/catalog/PublishVersionForm.vue";
import StatusChip from "../components/catalog/StatusChip.vue";
import { useAdminCatalog } from "../composables/catalog/use-admin-catalog.js";

const route = useRoute();
const itemId = computed(() => String(route.params.itemId));

// There is no per-item endpoint — the detail view reads its item out of the
// same list query the table uses (one cache entry, admin-scale data).
const catalogQuery = useAdminCatalog();
const item = computed(
  () =>
    catalogQuery.data.value?.find(
      (candidate) => candidate.itemId === itemId.value,
    ) ?? null,
);
</script>

<template>
  <section>
    <RouterLink class="back-link" :to="{ name: 'catalog' }">
      <ArrowLeft :size="14" />
      <span>Catalog</span>
    </RouterLink>

    <p v-if="catalogQuery.isPending.value" class="muted-note">Loading…</p>
    <div v-else-if="catalogQuery.isError.value" class="card">
      <p class="form-error">
        {{ catalogQuery.error.value?.message }}
      </p>
      <button type="button" class="button" @click="catalogQuery.refetch()">
        Retry
      </button>
    </div>
    <p v-else-if="item === null" class="muted-note">
      No catalog item named "{{ itemId }}" — it may have been removed.
    </p>
    <template v-else>
      <header class="item-header">
        <h1>{{ item.displayName }}</h1>
        <KindChip :kind="item.kind" />
        <StatusChip :status="item.status" />
        <span class="item-id">{{ item.itemId }}</span>
      </header>
      <div class="item-grid">
        <ItemMetadataForm :item="item" />
        <div class="item-side">
          <ItemStatusControl :item="item" />
          <ItemVersionsTable :versions="item.versions" />
        </div>
        <PublishVersionForm :item="item" class="publish-card" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-2);
  text-decoration: none;
  font-size: 12.5px;
  margin-bottom: 12px;
}

.back-link:hover {
  color: var(--ink-1);
}

.item-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

h1 {
  font-size: 17px;
  margin: 0;
}

.item-id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-3);
}

.item-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(320px, 1fr);
  gap: 16px;
  align-items: start;
}

.item-side {
  display: grid;
  gap: 16px;
}

.publish-card {
  grid-column: 1 / -1;
}
</style>
