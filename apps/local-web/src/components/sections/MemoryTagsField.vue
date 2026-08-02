<script setup lang="ts">
import { computed, ref } from "vue";
import { useMemoryTags } from "../../composables/memory/use-memory-tags.js";
import type { SectionScope } from "./section-scope.js";

// The tags field of the add-memory dialog: toggle the vault's known tags (the
// API leads with "context" — the always-in-context marker, gold-dotted) or
// coin a new one inline. The parent owns the selection; this owns the
// vocabulary read and the normalize/cap rules.
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 32;

const props = defineProps<{
  scope: SectionScope;
  selected: string[];
}>();

const emit = defineEmits<{
  "update:selected": [tags: string[]];
}>();

const tagsQuery = useMemoryTags(() => props.scope);
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
  <div class="grid gap-1.5">
    <span class="text-[11.5px] font-semibold text-ink-2">
      Tags
      <span class="text-[10px] font-medium uppercase tracking-wide text-ink-3">optional</span>
    </span>
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-for="tag in tagChips"
        :key="tag"
        type="button"
        class="inline-flex cursor-default items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-medium transition"
        :class="
          isSelected(tag)
            ? 'border-gold bg-gold-soft text-ink-1'
            : 'border-hair bg-panel text-ink-2 hover:border-hair-strong hover:text-ink-1'
        "
        :aria-pressed="isSelected(tag)"
        @click="toggleTag(tag)"
      >
        <span
          v-if="tag === 'context'"
          class="size-[5px] shrink-0 rounded-full bg-gold"
          aria-hidden="true"
        />
        {{ tag }}
      </button>
      <span
        class="inline-flex items-center rounded-full border border-dashed border-hair pl-2.5 pr-1 focus-within:border-solid focus-within:border-hair-strong"
      >
        <input
          v-model="newTag"
          type="text"
          class="new-tag-input w-[74px] bg-transparent py-1 text-[11.5px] font-medium text-ink-1"
          placeholder="new tag"
          aria-label="New tag"
          @keydown.enter.prevent="addNewTag"
        />
        <button
          type="button"
          class="new-tag-add cursor-default px-1.5 text-[13px] font-semibold text-ink-2 hover:text-ink-1"
          aria-label="Add tag"
          @click="addNewTag"
        >
          +
        </button>
      </span>
    </div>
    <p v-if="tagError" class="m-0 text-xs text-danger" role="alert">{{ tagError }}</p>
    <!-- "context" auto-loads into a WORKSPACE session only, so the global
         surface must not promise it — global memories are stored against your
         account and read on demand, not injected. -->
    <span v-if="props.scope.kind === 'workspace'" class="text-[11px] text-ink-3">
      Tag "context" to make this part of what Claude always knows in this
      workspace.
    </span>
    <span v-else class="text-[11px] text-ink-3">
      These live with your account rather than one workspace — tags are how you
      and Claude find them again.
    </span>
  </div>
</template>
