<script setup lang="ts">
import { computed, ref } from "vue";
import {
  useImportClaudeMarketplace,
  useInspectClaudeMarketplace,
  type ClaudeMarketplaceInspection,
} from "../composables/catalog/use-claude-marketplace-import.js";
import { AdminApiError } from "../lib/admin-api.js";

// The review queue: inspect a Claude-native marketplace repo (pinned at
// HEAD), tick the plugins worth carrying, approve — they publish as
// community `plugin` items (available, never endorsed). Re-running is safe:
// already-published items skip.
const url = ref("");
const inspection = ref<ClaudeMarketplaceInspection | null>(null);
const selectedNames = ref<Set<string>>(new Set());

const inspect = useInspectClaudeMarketplace();
const importPlugins = useImportClaudeMarketplace();

const canInspect = computed(() => url.value.trim().length > 7 && !inspect.isPending.value);

function runInspect() {
  if (!canInspect.value) return;
  inspection.value = null;
  selectedNames.value = new Set();
  importPlugins.reset();
  inspect.mutate(
    { url: url.value.trim() },
    {
      onSuccess: (found) => {
        inspection.value = found;
        selectedNames.value = new Set(
          found.plugins
            .filter((plugin) => !plugin.alreadyPublished)
            .map((plugin) => plugin.pluginName),
        );
      },
    },
  );
}

function toggle(pluginName: string) {
  const next = new Set(selectedNames.value);
  if (next.has(pluginName)) next.delete(pluginName);
  else next.add(pluginName);
  selectedNames.value = next;
}

const canImport = computed(
  () =>
    inspection.value !== null &&
    selectedNames.value.size > 0 &&
    !importPlugins.isPending.value,
);

function runImport() {
  const found = inspection.value;
  if (found === null || !canImport.value) return;
  importPlugins.mutate({
    url: found.repoUrl,
    pinnedSha: found.pinnedSha,
    marketplaceName: found.marketplaceName,
    ownerName: found.ownerName,
    selected: found.plugins.filter((plugin) => selectedNames.value.has(plugin.pluginName)),
  });
}

const importSummary = computed(() => {
  const result = importPlugins.data.value;
  if (!result) return null;
  const count = (outcome: string) =>
    result.items.filter((item) => item.outcome === outcome).length;
  const published = count("published");
  const skipped = count("skipped-already-published");
  const problems = result.items.filter(
    (item) => item.outcome !== "published" && item.outcome !== "skipped-already-published",
  );
  const problemNote =
    problems.length > 0
      ? ` · ${problems.length} failed (${problems
          .map((item) => `${item.pluginName}: ${item.detail ?? item.outcome}`)
          .join("; ")
          .slice(0, 300)})`
      : "";
  return `published ${published} · skipped ${skipped}${problemNote}`;
});

const errorMessage = computed(() => {
  const error = inspect.error.value ?? importPlugins.error.value;
  if (!error) return null;
  return error instanceof AdminApiError ? error.message : "Something went wrong.";
});
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">Import from a marketplace</h1>
    </header>

    <p class="muted-note">
      Point at a GitHub repo carrying a Claude plugin marketplace
      (.claude-plugin/marketplace.json). Inspection pins the current commit;
      approved plugins publish as community items — available, never badged
      official.
    </p>

    <form class="inspect-form" @submit.prevent="runInspect">
      <input
        v-model="url"
        type="url"
        placeholder="https://github.com/owner/repo"
        class="input"
        aria-label="Marketplace repository URL"
      />
      <button type="submit" class="button button-primary" :disabled="!canInspect">
        {{ inspect.isPending.value ? "Inspecting…" : "Inspect" }}
      </button>
    </form>

    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>

    <template v-if="inspection">
      <div class="card review-card">
        <p class="m-0">
          <strong>{{ inspection.marketplaceName }}</strong>
          <template v-if="inspection.ownerName"> · {{ inspection.ownerName }}</template>
          <span class="mono pin-note"> @ {{ inspection.pinnedSha.slice(0, 7) }}</span>
        </p>
        <p v-if="inspection.description" class="muted-note">{{ inspection.description }}</p>
      </div>

      <table class="catalog-table">
        <thead>
          <tr>
            <th></th>
            <th>Plugin</th>
            <th>Proposed id</th>
            <th>Version</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="plugin in inspection.plugins" :key="plugin.pluginName">
            <td>
              <input
                type="checkbox"
                :checked="selectedNames.has(plugin.pluginName)"
                :aria-label="`Approve ${plugin.pluginName}`"
                @change="toggle(plugin.pluginName)"
              />
            </td>
            <td>
              <p class="m-0">{{ plugin.pluginName }}</p>
              <p v-if="plugin.description" class="muted-note m-0">{{ plugin.description }}</p>
            </td>
            <td class="mono">{{ plugin.proposedItemId }}</td>
            <td class="mono">{{ plugin.version ?? "—" }}</td>
            <td>{{ plugin.alreadyPublished ? "published" : "new" }}</td>
          </tr>
        </tbody>
      </table>

      <div class="page-actions">
        <button type="button" class="button button-primary" :disabled="!canImport" @click="runImport">
          {{
            importPlugins.isPending.value
              ? "Publishing…"
              : `Approve ${selectedNames.size} plugin${selectedNames.size === 1 ? "" : "s"}`
          }}
        </button>
        <p v-if="importSummary" class="muted-note">{{ importSummary }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.inspect-form {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.inspect-form .input {
  flex: 1;
  max-width: 480px;
}
.review-card {
  margin-bottom: 12px;
}
.pin-note {
  color: var(--ink-3, #888);
}
.m-0 {
  margin: 0;
}
</style>
