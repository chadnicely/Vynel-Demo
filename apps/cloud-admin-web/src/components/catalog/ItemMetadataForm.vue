<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { HubAdminCatalogItem } from "@vynel/contracts/hub/admin";
import { AdminApiError } from "../../lib/admin-api.js";
import {
  useUpdateCatalogItem,
  type CatalogItemMetadataPatch,
} from "../../composables/catalog/use-update-catalog-item.js";

const props = defineProps<{ item: HubAdminCatalogItem }>();

const updateMutation = useUpdateCatalogItem();

// '' stands in for null in the scope <select> (options can't carry null).
type ScopeOption = "" | "user" | "workspace" | "both";

function baselineFields(item: HubAdminCatalogItem) {
  // The annotation stops TS widening the literal union to string inside the
  // mutable form object.
  const recommendedScope: ScopeOption = item.recommendedScope ?? "";
  return {
    displayName: item.displayName,
    oneLineDescription: item.oneLineDescription,
    category: item.category,
    iconName: item.iconName,
    recommendedScope,
    // '' stands in for null (no upstream origin) in the text input.
    sourceUrl: item.sourceUrl ?? "",
    minimumTier: item.minimumTier,
  };
}

const form = reactive(baselineFields(props.item));

// Re-baseline only when the route moves to another item — a background
// refetch must not clobber in-progress edits.
watch(
  () => props.item.itemId,
  () => Object.assign(form, baselineFields(props.item)),
);

const patch = computed<CatalogItemMetadataPatch>(() => {
  const baseline = baselineFields(props.item);
  const changed: CatalogItemMetadataPatch = {};
  if (form.displayName !== baseline.displayName)
    changed.displayName = form.displayName;
  if (form.oneLineDescription !== baseline.oneLineDescription)
    changed.oneLineDescription = form.oneLineDescription;
  if (form.category !== baseline.category) changed.category = form.category;
  if (form.iconName !== baseline.iconName) changed.iconName = form.iconName;
  if (form.recommendedScope !== baseline.recommendedScope)
    changed.recommendedScope =
      form.recommendedScope === "" ? null : form.recommendedScope;
  if (form.sourceUrl.trim() !== baseline.sourceUrl)
    changed.sourceUrl = form.sourceUrl.trim() === "" ? null : form.sourceUrl.trim();
  if (form.minimumTier !== baseline.minimumTier)
    changed.minimumTier = form.minimumTier;
  return changed;
});

// The hub 400s an empty patch — Save stays disabled until something changed.
const isDirty = computed(() => Object.keys(patch.value).length > 0);

const errorMessage = computed(() => {
  const error = updateMutation.error.value;
  if (error === null) return null;
  return error instanceof AdminApiError
    ? error.message
    : "Saving failed — try again.";
});

function save() {
  updateMutation.mutate({ itemId: props.item.itemId, patch: patch.value });
}
</script>

<template>
  <form class="card" @submit.prevent="save">
    <h2>Metadata</h2>
    <label class="field">
      <span class="field-label">Display name</span>
      <input v-model="form.displayName" class="text-input" type="text" />
    </label>
    <label class="field">
      <span class="field-label">One-line description</span>
      <input v-model="form.oneLineDescription" class="text-input" type="text" />
    </label>
    <div class="field-row">
      <label class="field">
        <span class="field-label">Category</span>
        <input v-model="form.category" class="text-input" type="text" />
      </label>
      <label class="field">
        <span class="field-label">Icon name</span>
        <input v-model="form.iconName" class="text-input" type="text" />
      </label>
    </div>
    <label class="field">
      <span class="field-label">Source URL</span>
      <!-- The credit line's upstream-origin link (e.g. the pinned
           anthropics/skills folder). Empty = first-party, no Source link. -->
      <input
        v-model="form.sourceUrl"
        class="text-input"
        type="url"
        placeholder="https://github.com/…"
      />
    </label>
    <div class="field-row">
      <label class="field">
        <span class="field-label">Recommended scope</span>
        <select v-model="form.recommendedScope" class="select-input">
          <option value="">None</option>
          <option value="user">User</option>
          <option value="workspace">Workspace</option>
          <option value="both">User and workspace</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Minimum tier</span>
        <select v-model="form.minimumTier" class="select-input">
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
        </select>
      </label>
    </div>
    <button
      type="submit"
      class="button button-primary"
      :disabled="!isDirty || updateMutation.isPending.value"
    >
      {{ updateMutation.isPending.value ? "Saving…" : "Save" }}
    </button>
    <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
    <p
      v-else-if="updateMutation.isSuccess.value && !isDirty"
      class="form-success"
    >
      Saved.
    </p>
  </form>
</template>

<style scoped>
h2 {
  font-size: 14px;
  margin: 0 0 12px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
</style>
