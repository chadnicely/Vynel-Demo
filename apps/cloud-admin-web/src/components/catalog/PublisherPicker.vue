<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  useCatalogPublishers,
  type CatalogPublisherOption,
} from "../../composables/catalog/use-catalog-publishers.js";

// Picks WHO publishes: an existing publisher (its EXACT stored fields ride
// the publish body — `upsertPublisher` re-writes the row verbatim, so a
// stale/edited copy would silently rename or re-tier it) or "+ new
// publisher" with fresh id/name/tier/url. Emits null while the choice is
// incomplete so the host can block submit.
const props = defineProps<{ modelValue: CatalogPublisherOption | null }>();
const emit = defineEmits<{
  "update:modelValue": [value: CatalogPublisherOption | null];
}>();

const NEW_PUBLISHER = "__new__";

const publishers = useCatalogPublishers();
const selectedId = ref<string>("");
const draft = reactive({
  id: "",
  name: "",
  tier: "community" as CatalogPublisherOption["tier"],
  url: "",
});

const isCreating = computed(() => selectedId.value === NEW_PUBLISHER);

function resolve(): CatalogPublisherOption | null {
  if (isCreating.value) {
    if (draft.id.trim() === "" || draft.name.trim() === "") return null;
    return {
      id: draft.id.trim(),
      name: draft.name.trim(),
      tier: draft.tier,
      url: draft.url.trim() === "" ? null : draft.url.trim(),
    };
  }
  return publishers.value.find((p) => p.id === selectedId.value) ?? null;
}

watch([selectedId, draft, publishers], () => emit("update:modelValue", resolve()), {
  deep: true,
});

// Default once the list arrives: vynel-team when present, else the first
// publisher, else the new-publisher form prefilled with the house identity.
watch(
  publishers,
  (list) => {
    if (selectedId.value !== "") return;
    const vynelTeam = list.find((p) => p.id === "vynel-team");
    if (vynelTeam !== undefined) selectedId.value = vynelTeam.id;
    else if (list.length > 0) selectedId.value = list[0]!.id;
    else {
      selectedId.value = NEW_PUBLISHER;
      draft.id = "vynel-team";
      draft.name = "Vynel Team";
      draft.tier = "verified";
    }
  },
  { immediate: true },
);

/** Prefill from an inspected vynel-item.json: an id that already exists
 *  selects the stored publisher (exact-fields rule); an unknown id opens the
 *  new-publisher form with the manifest's values. */
function applyPrefill(prefill: {
  id?: string;
  name?: string;
  tier?: CatalogPublisherOption["tier"];
  url?: string | null;
}) {
  if (prefill.id !== undefined && publishers.value.some((p) => p.id === prefill.id)) {
    selectedId.value = prefill.id;
    return;
  }
  selectedId.value = NEW_PUBLISHER;
  draft.id = prefill.id ?? "";
  draft.name = prefill.name ?? "";
  draft.tier = prefill.tier ?? "community";
  draft.url = prefill.url ?? "";
}

defineExpose({ applyPrefill });
</script>

<template>
  <div class="publisher-picker">
    <select v-model="selectedId" class="select-input" aria-label="Publisher">
      <option
        v-for="publisher in publishers"
        :key="publisher.id"
        :value="publisher.id"
      >
        {{ publisher.name }} ({{ publisher.tier }})
      </option>
      <option :value="NEW_PUBLISHER">+ new publisher…</option>
    </select>
    <div v-if="isCreating" class="draft-grid">
      <label class="field">
        <span class="field-label">Publisher id</span>
        <input
          v-model="draft.id"
          class="text-input"
          type="text"
          placeholder="acme-tools"
        />
      </label>
      <label class="field">
        <span class="field-label">Publisher name</span>
        <input v-model="draft.name" class="text-input" type="text" placeholder="Acme Tools" />
      </label>
      <label class="field">
        <span class="field-label">Tier</span>
        <select v-model="draft.tier" class="select-input">
          <option value="community">Community</option>
          <option value="verified">Verified</option>
          <option value="anthropic-official">Anthropic official</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Publisher URL</span>
        <input
          v-model="draft.url"
          class="text-input"
          type="url"
          placeholder="https://github.com/acme"
        />
      </label>
    </div>
    <p v-else-if="modelValue" class="picked-note">
      Publishing as <strong>{{ modelValue.name }}</strong> ({{ modelValue.tier
      }}<template v-if="modelValue.tier === 'anthropic-official'">
        — badges "By Anthropic"</template
      >), fields exactly as stored.
    </p>
  </div>
</template>

<style scoped>
.publisher-picker {
  display: grid;
  gap: 6px;
}

.draft-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

.picked-note {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink-3);
}
</style>
