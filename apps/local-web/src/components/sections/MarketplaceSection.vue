<script setup lang="ts">
import { computed, ref } from "vue";
import { Blocks, Check, Search, SearchX, Store } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";
import type { MarketplaceItem } from "@vynel/contracts/marketplace/marketplace-item";
import type { SectionScope } from "./section-scope.js";
import { useHubFeatures } from "../../composables/hub/use-hub-features.js";
import { useMarketplaceItems } from "../../composables/marketplace/use-marketplace-items.js";
import {
  KIND_FILTERS,
  useMarketplaceShelfFilters,
} from "../../composables/marketplace/use-marketplace-shelf-filters.js";
import { useConnectMcpItem } from "../../composables/marketplace/use-connect-mcp-item.js";
import { useInstallMarketplaceItem } from "../../composables/marketplace/use-install-marketplace-item.js";
import { useUpdateMarketplaceItem } from "../../composables/marketplace/use-update-marketplace-item.js";
import { useUninstallMarketplaceItem } from "../../composables/marketplace/use-uninstall-marketplace-item.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import ConfigureMcpItemDialog from "./ConfigureMcpItemDialog.vue";
import ManageMarketplacesDialog from "./ManageMarketplacesDialog.vue";
import MarketplaceItemCard from "./MarketplaceItemCard.vue";
import SectionHeader from "./SectionHeader.vue";

// The storefront: curated skills and agents, one Get away. Scope-aware
// like its section siblings — the GLOBAL menu shows user-level items and
// installs at user scope, a workspace drawer shows that workspace's shelf
// (the composables pick the endpoints per surface). Hosts only mount this
// section while it's the active panel AND the feature is unlocked
// (LockedFeatureCard renders in its place otherwise), so the catalog read
// runs unconditionally here.
const props = defineProps<{
  scope: SectionScope;
}>();

const itemsQuery = useMarketplaceItems(() => props.scope, true);
const items = computed(() => itemsQuery.data.value ?? []);

const sectionHint = computed(() =>
  props.scope.kind === "global"
    ? "Curated skills and agents, ready to add for you"
    : "Curated skills and agents, ready to add to this workspace",
);

const { isPro } = useHubFeatures();

// Filter state + composition live in the composable (one home); this file
// stays the layout.
const {
  searchText,
  kindFilter,
  showInstalledOnly,
  sourceFilter,
  marketplaceNames,
  visibleItems,
  clearFilters,
} = useMarketplaceShelfFilters(items);

const manageMarketplacesOpen = ref(false);

// "Nothing here yet" and "your filters matched nothing" are different
// stories — the second must say so, or a filtered-out shelf reads as broken.
const isCatalogEmpty = computed(
  () => !itemsQuery.isPending.value && items.value.length === 0,
);

// One install mutation drives the whole grid; `variables` scopes its pending
// and error state to the card the user actually clicked (AccountSection idiom).
const install = useInstallMarketplaceItem();

// An mcp item declaring required values (API keys, tokens) detours through
// the configure dialog — Get opens it, submit installs with the values. The
// dialog closes on submit; success/failure lands on the card like any
// install (a failed one re-opens the dialog via another Get).
const configuringItem = ref<MarketplaceItem | null>(null);

function requestInstall(item: MarketplaceItem) {
  if (item.mcpAuth?.kind === "fields") {
    configuringItem.value = item;
    return;
  }
  install.mutate({ scope: props.scope, itemId: item.itemId });
}

function submitConfiguredInstall(values: Record<string, string>) {
  const item = configuringItem.value;
  configuringItem.value = null;
  if (item === null) return;
  install.mutate({
    scope: props.scope,
    itemId: item.itemId,
    mcpConfigurationValues: values,
  });
}

function isInstalling(itemId: string): boolean {
  return install.isPending.value && install.variables.value?.itemId === itemId;
}

const update = useUpdateMarketplaceItem();

function isUpdating(itemId: string): boolean {
  return update.isPending.value && update.variables.value?.itemId === itemId;
}

// Connect (OAuth items): the browser sign-in via the daemon. `connectedItemId`
// is the transient success readback — there is no persisted connection state
// to query (the credential lives in Claude's own store), so the card shows
// "Connected" until the next action replaces it.
const connect = useConnectMcpItem();
const connectedItemId = ref<string | null>(null);

function requestConnect(item: MarketplaceItem) {
  if (item.installStatus.kind !== "installed" || item.mcpServerName === undefined) return;
  connectedItemId.value = null;
  connect.mutate(
    {
      itemId: item.itemId,
      serverName: item.mcpServerName,
      installScope: item.installStatus.scope,
      workspaceId: props.scope.kind === "workspace" ? props.scope.workspaceId : null,
    },
    { onSuccess: () => (connectedItemId.value = item.itemId) },
  );
}

function isConnecting(itemId: string): boolean {
  return connect.isPending.value && connect.variables.value?.itemId === itemId;
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
  uninstall.mutate({ scope: props.scope, itemId });
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
  if (update.isError.value && update.variables.value?.itemId === itemId) {
    return formatSdkError(update.error.value);
  }
  if (uninstall.isError.value && uninstall.variables.value?.itemId === itemId) {
    return formatSdkError(uninstall.error.value);
  }
  if (connect.isError.value && connect.variables.value?.itemId === itemId) {
    return formatSdkError(connect.error.value);
  }
  return null;
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <SectionHeader :icon="Blocks" title="Marketplace" :subtitle="sectionHint" />

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
      <div class="flex flex-wrap items-center gap-2">
        <label class="relative min-w-[160px] max-w-[320px] flex-1">
          <Search
            :size="13"
            class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            v-model="searchText"
            type="search"
            placeholder="Search skills and agents"
            aria-label="Search the marketplace"
            class="w-full rounded-full border border-hair-strong bg-panel py-1 pl-7 pr-3 text-xs text-ink-1 placeholder:text-ink-3"
          />
        </label>
        <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Filter the shelf">
          <button
            v-for="option in KIND_FILTERS"
            :key="option.value"
            type="button"
            class="filter-chip inline-flex cursor-default items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition"
            :class="
              kindFilter === option.value
                ? 'border-hair-strong bg-row-active text-ink-1'
                : 'border-transparent text-ink-3 hover:bg-row-hover hover:text-ink-1'
            "
            :aria-pressed="kindFilter === option.value"
            @click="kindFilter = option.value"
          >
            {{ option.label }}
          </button>
          <span class="mx-1 h-3.5 w-px bg-hair-strong" aria-hidden="true" />
          <button
            type="button"
            class="filter-chip inline-flex cursor-default items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition"
            :class="
              showInstalledOnly
                ? 'border-hair-strong bg-row-active text-ink-1'
                : 'border-transparent text-ink-3 hover:bg-row-hover hover:text-ink-1'
            "
            :aria-pressed="showInstalledOnly"
            @click="showInstalledOnly = !showInstalledOnly"
          >
            <Check :size="11" />
            Installed
          </button>
        </div>
        <div
          v-if="marketplaceNames.length > 0"
          class="flex flex-wrap items-center gap-1"
          role="group"
          aria-label="Filter by source"
        >
          <button
            v-for="option in [
              { value: 'all', label: 'All sources' },
              { value: 'vynel', label: 'Vynel' },
              ...marketplaceNames.map((name) => ({ value: name, label: name })),
            ]"
            :key="option.value"
            type="button"
            class="source-chip inline-flex cursor-default items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition"
            :class="
              sourceFilter === option.value
                ? 'border-hair-strong bg-row-active text-ink-1'
                : 'border-transparent text-ink-3 hover:bg-row-hover hover:text-ink-1'
            "
            :aria-pressed="sourceFilter === option.value"
            @click="sourceFilter = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <button
          v-if="props.scope.kind === 'global'"
          type="button"
          class="ml-auto inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3 py-0.5 text-[11px] font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          @click="manageMarketplacesOpen = true"
        >
          <Store :size="12" />
          Marketplaces
        </button>
      </div>

      <div
        v-if="visibleItems.length > 0"
        class="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2"
      >
        <MarketplaceItemCard
          v-for="item in visibleItems"
          :key="item.itemId"
          :item="item"
          :is-pro="isPro"
          :is-installing="isInstalling(item.itemId)"
          :is-updating="isUpdating(item.itemId)"
          :is-removing="isRemoving(item.itemId)"
          :is-remove-armed="armedRemoveItemId === item.itemId"
          :is-connecting="isConnecting(item.itemId)"
          :is-connected="connectedItemId === item.itemId"
          :error-message="cardErrorFor(item.itemId)"
          @install="requestInstall(item)"
          @connect="requestConnect(item)"
          @update="update.mutate({ scope: props.scope, itemId: item.itemId })"
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
          <button
            type="button"
            class="inline-flex cursor-default items-center gap-1.5 rounded-full border border-hair-strong bg-raised px-3.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
            @click="clearFilters"
          >
            Clear search and filters
          </button>
        </template>
      </EmptyState>
    </template>

    <ConfigureMcpItemDialog
      :open="configuringItem !== null"
      :item="configuringItem"
      @close="configuringItem = null"
      @submit="submitConfiguredInstall"
    />

    <ManageMarketplacesDialog
      v-if="props.scope.kind === 'global'"
      :open="manageMarketplacesOpen"
      @close="manageMarketplacesOpen = false"
    />
  </div>
</template>
