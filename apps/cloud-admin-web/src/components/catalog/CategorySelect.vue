<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { normalizeCatalogCategory } from "@vynel/contracts/marketplace/catalog-categories";
import { useCatalogCategories } from "../../composables/catalog/use-catalog-categories.js";

// A select over the live category vocabulary (baseline ∪ catalog-derived —
// admin-defined, global to all users) with a "+ new category" branch that
// reveals a text input. New text is normalized to kebab-case before it ever
// reaches the model, so the hub only stores canonical categories.
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const NEW_CATEGORY = "__new__";

const categories = useCatalogCategories();
const isCreating = ref(false);
const newCategoryText = ref("");

// The options must always include the model's current value (an item can
// carry a category the live list no longer derives).
const options = computed(() => {
  const all = new Set(categories.value);
  if (props.modelValue !== "") all.add(props.modelValue);
  return [...all].sort();
});

const selectValue = computed(() =>
  isCreating.value ? NEW_CATEGORY : props.modelValue,
);

function handleSelect(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === NEW_CATEGORY) {
    isCreating.value = true;
    newCategoryText.value = "";
    emit("update:modelValue", "");
    return;
  }
  isCreating.value = false;
  emit("update:modelValue", value);
}

watch(newCategoryText, (text) => {
  if (isCreating.value) emit("update:modelValue", normalizeCatalogCategory(text));
});
</script>

<template>
  <div class="category-select">
    <select
      class="select-input"
      :value="selectValue"
      aria-label="Category"
      @change="handleSelect"
    >
      <option value="" disabled>Pick a category…</option>
      <option v-for="category in options" :key="category" :value="category">
        {{ category }}
      </option>
      <option :value="NEW_CATEGORY">+ new category…</option>
    </select>
    <template v-if="isCreating">
      <input
        v-model="newCategoryText"
        class="text-input"
        type="text"
        placeholder="e.g. data-science"
        aria-label="New category name"
      />
      <span class="field-hint">
        Stored as
        <code>{{ modelValue === "" ? "…" : modelValue }}</code>
        — categories are global to all users.
      </span>
    </template>
  </div>
</template>

<style scoped>
.category-select {
  display: grid;
  gap: 6px;
}

.field-hint {
  color: var(--ink-3);
  font-size: 11.5px;
}

code {
  font-family: var(--font-mono);
}
</style>
