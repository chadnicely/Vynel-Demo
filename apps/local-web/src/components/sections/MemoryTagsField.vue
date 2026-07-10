<script setup lang="ts">
import { computed, ref } from "vue";
import { useMemoryTags } from "../../composables/memory/use-memory-tags.js";

// The tags field of the add-memory dialog: toggle the workspace's known tags
// (the API leads with "context" — the always-in-context marker, gold-dotted)
// or coin a new one inline. The parent owns the selection; this owns the
// vocabulary read and the normalize/cap rules.
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 32;

const props = defineProps<{
  workspaceId: string | null;
  selected: string[];
}>();

const emit = defineEmits<{
  "update:selected": [tags: string[]];
}>();

const tagsQuery = useMemoryTags(() => props.workspaceId);
const knownTags = computed(() => tagsQuery.data.value ?? []);

// A freshly coined tag isn't in the vocabulary yet — still render its chip.
const tagChips = computed(() => [
  ...knownTags.value,
  ...props.selected.filter((tag) => !knownTags.value.includes(tag)),
]);

const newTag = ref("");
const tagError = ref<string | null>(null);

function isSelected(tag: string) {
  return props.selected.includes(tag);
}

function toggleTag(tag: string) {
  tagError.value = null;
  if (isSelected(tag)) {
    emit(
      "update:selected",
      props.selected.filter((row) => row !== tag),
    );
    return;
  }
  if (props.selected.length >= MAX_TAGS) {
    tagError.value = `Up to ${MAX_TAGS} tags per memory.`;
    return;
  }
  emit("update:selected", [...props.selected, tag]);
}

function addNewTag() {
  const tag = newTag.value.trim().toLowerCase();
  if (tag.length === 0) return;
  if (tag.length > MAX_TAG_LENGTH) {
    tagError.value = `Tags are ${MAX_TAG_LENGTH} characters max.`;
    return;
  }
  if (!isSelected(tag)) {
    if (props.selected.length >= MAX_TAGS) {
      tagError.value = `Up to ${MAX_TAGS} tags per memory.`;
      return;
    }
    emit("update:selected", [...props.selected, tag]);
  }
  tagError.value = null;
  newTag.value = "";
}
</script>

<template>
  <div class="field">
    <span class="field-label">
      Tags <span class="optional-tag">optional</span>
    </span>
    <div class="chips">
      <button
        v-for="tag in tagChips"
        :key="tag"
        type="button"
        class="chip"
        :class="{ 'is-selected': isSelected(tag) }"
        :aria-pressed="isSelected(tag)"
        @click="toggleTag(tag)"
      >
        <span v-if="tag === 'context'" class="context-dot" aria-hidden="true" />
        {{ tag }}
      </button>
      <span class="new-tag">
        <input
          v-model="newTag"
          type="text"
          class="new-tag-input"
          placeholder="new tag"
          aria-label="New tag"
          @keydown.enter.prevent="addNewTag"
        />
        <button
          type="button"
          class="new-tag-add"
          aria-label="Add tag"
          @click="addNewTag"
        >
          +
        </button>
      </span>
    </div>
    <p v-if="tagError" class="tag-error" role="alert">{{ tagError }}</p>
    <span class="field-hint">
      Tag "context" to make this part of what Claude always knows in this
      workspace.
    </span>
  </div>
</template>

<style scoped>
.field {
  display: grid;
  gap: 6px;
}

.field-label {
  color: var(--ink-2);
  font: 600 11.5px/1.5 var(--font-ui);
}

.optional-tag {
  color: var(--ink-3);
  font: 500 10px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.chip {
  appearance: none;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  background: var(--bg-panel);
  color: var(--ink-2);
  font: 500 11.5px/1.5 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.chip:hover {
  color: var(--ink-1);
  border-color: var(--hair-strong);
}

.chip.is-selected {
  color: var(--ink-1);
  border-color: var(--gold);
  background: var(--gold-soft);
}

.chip:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.context-dot {
  width: 5px;
  height: 5px;
  border-radius: 99px;
  background: var(--gold);
  flex: none;
}

.new-tag {
  display: inline-flex;
  align-items: center;
  border: 1px dashed var(--hair);
  border-radius: 99px;
  padding: 0 4px 0 10px;
}

.new-tag:focus-within {
  border-style: solid;
  border-color: var(--hair-strong);
}

.new-tag-input {
  appearance: none;
  border: 0;
  width: 74px;
  padding: 4px 0;
  background: transparent;
  color: var(--ink-1);
  font: 500 11.5px/1.5 var(--font-ui);
}

.new-tag-input:focus-visible {
  outline: none;
}

.new-tag-add {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 0 6px;
  background: transparent;
  color: var(--ink-2);
  font: 600 13px/1.4 var(--font-ui);
  cursor: default;
}

.new-tag-add:hover {
  color: var(--ink-1);
}

.new-tag-add:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
  border-radius: 99px;
}

.tag-error {
  margin: 0;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.field-hint {
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}
</style>
