<script setup lang="ts">
import { computed } from "vue";
import {
  CATALOG_ICON_NAMES,
  isCatalogIconName,
} from "@vynel/contracts/marketplace/catalog-icons";
import { CATALOG_ICON_COMPONENTS } from "./catalog-icon-components.js";

// A grid over the curated contracts allowlist — never free text, so every
// published iconName renders a real icon on the desktop card. '' = none
// picked yet: the preview shows the monogram the card would fall back to.
const props = defineProps<{
  modelValue: string;
  /** Text the monogram preview derives from (usually the display name). */
  fallbackText: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const monogram = computed(() => {
  const words = props.fallbackText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const initials =
    words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : words[0]!.slice(0, 2);
  return initials.toUpperCase();
});

const selectedComponent = computed(() =>
  isCatalogIconName(props.modelValue)
    ? CATALOG_ICON_COMPONENTS[props.modelValue]
    : null,
);

function pick(name: string) {
  // Clicking the selected icon clears it back to the monogram fallback.
  emit("update:modelValue", props.modelValue === name ? "" : name);
}
</script>

<template>
  <div class="icon-picker">
    <div class="preview-row">
      <span class="preview-tile" aria-hidden="true">
        <component :is="selectedComponent" v-if="selectedComponent" :size="16" />
        <span v-else class="preview-monogram">{{ monogram }}</span>
      </span>
      <span class="preview-caption">
        {{ modelValue === "" ? "No icon — the card shows a monogram" : modelValue }}
      </span>
    </div>
    <div class="icon-grid" role="listbox" aria-label="Item icon">
      <button
        v-for="name in CATALOG_ICON_NAMES"
        :key="name"
        type="button"
        class="icon-cell"
        :class="{ 'is-selected': name === modelValue }"
        role="option"
        :aria-selected="name === modelValue"
        :title="name"
        @click="pick(name)"
      >
        <component :is="CATALOG_ICON_COMPONENTS[name]" :size="15" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.icon-picker {
  display: grid;
  gap: 8px;
}

.preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-tile {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  background: var(--bg-shell);
  color: var(--ink-2);
}

.preview-monogram {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.preview-caption {
  font-size: 11.5px;
  color: var(--ink-3);
  font-family: var(--font-mono);
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(30px, 1fr));
  gap: 4px;
}

.icon-cell {
  display: grid;
  place-items: center;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.icon-cell:hover {
  border-color: var(--hair-strong);
  color: var(--ink-1);
}

.icon-cell.is-selected {
  border-color: var(--gold);
  color: var(--gold);
}
</style>
