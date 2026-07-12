<script setup lang="ts">
import { computed, ref } from "vue";
import { Blocks, Check, Search, SearchX } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import type { MarketplaceItem } from "@vynel/contracts/marketplace/marketplace-item";
import { useHubFeatures } from "../../composables/hub/use-hub-features.js";
import { useMarketplaceItems } from "../../composables/marketplace/use-marketplace-items.js";
import { useInstallMarketplaceItem } from "../../composables/marketplace/use-install-marketplace-item.js";
import { useUninstallMarketplaceItem } from "../../composables/marketplace/use-uninstall-marketplace-item.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import MarketplaceItemCard from "./MarketplaceItemCard.vue";

// The storefront: curated skills and agents, one Get away. The panel only
// mounts this section while it's the active drawer panel AND the feature is
// unlocked (LockedFeatureCard renders in its place otherwise), so the
// catalog read runs unconditionally here.
const props = defineProps<{
  workspaceId: string;
}>();

const itemsQuery = useMarketplaceItems(() => props.workspaceId, true);
const items = computed(() => itemsQuery.data.value ?? []);

const { isPro } = useHubFeatures();

// --- Search + filters: client-side, plain computed — the curated catalog is
// small, so there's nothing to debounce or page. Filters compose with AND.
type KindFilter = "all" | "skill" | "agent";

const KIND_FILTERS: Array<{ value: KindFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "skill", label: "Skills" },
  { value: "agent", label: "Agents" },
];

const searchText = ref("");
const kindFilter = ref<KindFilter>("all");
const showInstalledOnly = ref(false);

function matchesSearch(item: MarketplaceItem, query: string): boolean {
  return [item.displayName, item.oneLineDescription, item.category].some(
    (field) => field.toLowerCase().includes(query),
  );
}

const visibleItems = computed(() => {
  const query = searchText.value.trim().toLowerCase();
  return items.value.filter(
    (item) =>
      (kindFilter.value === "all" || item.kind === kindFilter.value) &&
      (!showInstalledOnly.value || item.installStatus.kind === "installed") &&
      (query.length === 0 || matchesSearch(item, query)),
  );
});

function clearFilters() {
  searchText.value = "";
  kindFilter.value = "all";
  showInstalledOnly.value = false;
}

// "Nothing here yet" and "your filters matched nothing" are different
// stories — the second must say so, or a filtered-out shelf reads as broken.
const isCatalogEmpty = computed(
  () => !itemsQuery.isPending.value && items.value.length === 0,
);

// One install mutation drives the whole grid; `variables` scopes its pending
// and error state to the card the user actually clicked (AccountSection idiom).
const install = useInstallMarketplaceItem();

function isInstalling(itemId: string): boolean {
  return install.isPending.value && install.variables.value?.itemId === itemId;
}

// Removing is irreversible (a skill's settings die with the row; a cloud item
// re-downloads on the next Get) — so, per the AccountDeviceRow / Notebook
// idiom, Remove arms first and only a second explicit click uninstalls.
const uninstall = useUninstallMarketplaceItem();
const armedRemoveItemId = ref<string | null>(null);

function requestRemove(itemId: string) {
  if (armedRemoveItemId.value !== itemId) {
    armedRemoveItemId.value = itemId;
    return;
  }
  armedRemoveItemId.value = null;
  uninstall.mutate({ workspaceId: props.workspaceId, itemId });
}

function disarmRemove(itemId: string) {
  if (armedRemoveItemId.value === itemId) armedRemoveItemId.value = null;
}

function isRemoving(itemId: string): boolean {
  return (
    uninstall.isPending.value && uninstall.variables.value?.itemId === itemId
  );
}

function cardErrorFor(itemId: string): string | null {
  if (install.isError.value && install.variables.value?.itemId === itemId) {
    return formatSdkError(install.error.value);
  }
  if (uninstall.isError.value && uninstall.variables.value?.itemId === itemId) {
    return formatSdkError(uninstall.error.value);
  }
  return null;
}
</script>

<template>
  <div class="marketplace-section">
    <header class="section-header">
      <Blocks :size="15" class="section-icon" />
      <div class="section-text">
        <p class="section-title">Marketplace</p>
        <p class="section-hint">
          Curated skills and agents, ready to add to this workspace
        </p>
      </div>
    </header>

    <div v-if="itemsQuery.isError.value" role="alert">
      <EmptyState
        title="The marketplace didn't load"
        :hint="formatSdkError(itemsQuery.error.value)"
      >
        <template #icon>
          <Blocks :size="22" />
        </template>
      </EmptyState>
    </div>

    <EmptyState
      v-else-if="isCatalogEmpty"
      title="The shelf is empty"
      hint="Nothing is published to the marketplace yet — curated skills and agents appear here as they ship."
    >
      <template #icon>
        <Blocks :size="22" />
      </template>
    </EmptyState>

    <template v-else-if="items.length > 0">
      <div class="storefront-toolbar">
        <label class="search-field">
          <Search :size="13" class="search-icon" />
          <input
            v-model="searchText"
            type="search"
            placeholder="Search skills and agents"
            aria-label="Search the marketplace"
          />
        </label>
        <div class="filter-chips" role="group" aria-label="Filter the shelf">
          <button
            v-for="option in KIND_FILTERS"
            :key="option.value"
            type="button"
            class="filter-chip"
            :class="{ 'is-active': kindFilter === option.value }"
            :aria-pressed="kindFilter === option.value"
            @click="kindFilter = option.value"
          >
            {{ option.label }}
          </button>
          <span class="chip-divider" aria-hidden="true" />
          <button
            type="button"
            class="filter-chip"
            :class="{ 'is-active': showInstalledOnly }"
            :aria-pressed="showInstalledOnly"
            @click="showInstalledOnly = !showInstalledOnly"
          >
            <Check :size="11" />
            Installed
          </button>
        </div>
      </div>

      <div v-if="visibleItems.length > 0" class="storefront-grid">
        <MarketplaceItemCard
          v-for="item in visibleItems"
          :key="item.itemId"
          :item="item"
          :is-pro="isPro"
          :is-installing="isInstalling(item.itemId)"
          :is-removing="isRemoving(item.itemId)"
          :is-remove-armed="armedRemoveItemId === item.itemId"
          :error-message="cardErrorFor(item.itemId)"
          @install="
            install.mutate({
              workspaceId: props.workspaceId,
              itemId: item.itemId,
            })
          "
          @remove-request="requestRemove(item.itemId)"
          @remove-blur="disarmRemove(item.itemId)"
        />
      </div>

      <EmptyState
        v-else
        title="Nothing matches"
        hint="No skill or agent fits that search and filter combination — try different words or clear the filters."
      >
        <template #icon>
          <SearchX :size="22" />
        </template>
        <template #action>
          <button type="button" class="clear-button" @click="clearFilters">
            Clear search and filters
          </button>
        </template>
      </EmptyState>
    </template>
  </div>
</template>

<style scoped>
.marketplace-section {
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

.storefront-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.search-field {
  position: relative;
  flex: 1 1 200px;
  min-width: 160px;
  max-width: 320px;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  translate: 0 -50%;
  color: var(--ink-3);
  pointer-events: none;
}

.search-field input {
  appearance: none;
  width: 100%;
  padding: 5px 12px 5px 29px;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  background: var(--bg-panel);
  color: var(--ink-1);
  font: 400 12px/1.5 var(--font-ui);
}

.search-field input::placeholder {
  color: var(--ink-3);
}

.search-field input:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: -1px;
}

.filter-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.filter-chip {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 11px;
  border: 1px solid transparent;
  border-radius: 99px;
  background: transparent;
  color: var(--ink-3);
  font: 600 11px/1.6 var(--font-ui);
  cursor: default;
  transition:
    color var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out);
}

.filter-chip:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.filter-chip.is-active {
  color: var(--ink-1);
  background: var(--row-active);
  border-color: var(--hair-strong);
}

.filter-chip:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.chip-divider {
  width: 1px;
  height: 14px;
  background: var(--hair-strong);
  margin: 0 4px;
  flex: none;
}

.storefront-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 8px;
}

.clear-button {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 14px;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  background: var(--bg-raised);
  color: var(--ink-2);
  font: 600 11.5px/1.6 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.clear-button:hover {
  color: var(--ink-1);
  background: var(--row-hover);
}

.clear-button:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
