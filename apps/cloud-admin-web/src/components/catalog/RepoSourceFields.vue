<script setup lang="ts">
import { computed } from "vue";
import { AdminApiError } from "../../lib/admin-api.js";
import {
  useInspectRepo,
  type InspectRepoResponse,
} from "../../composables/catalog/use-inspect-repo.js";

// The "From GitHub URL" source block: url + ref + subpath, plus Inspect —
// the hub clones the pinned folder and answers with what it would publish;
// the host applies the prefill to its form. The component owns only the
// source fields (v-model per field) and the inspect round-trip.
const props = defineProps<{
  url: string;
  gitRef: string;
  subpath: string;
}>();

const emit = defineEmits<{
  "update:url": [value: string];
  "update:gitRef": [value: string];
  "update:subpath": [value: string];
  inspected: [result: InspectRepoResponse];
}>();

const inspectMutation = useInspectRepo();

const errorMessage = computed(() => {
  const error = inspectMutation.error.value;
  if (error === null) return null;
  return error instanceof AdminApiError
    ? error.message
    : "Inspecting failed — try again.";
});

const inspected = computed(() => inspectMutation.data.value ?? null);

function inspect() {
  inspectMutation.mutate(
    {
      url: props.url.trim(),
      ...(props.gitRef.trim() !== "" ? { ref: props.gitRef.trim() } : {}),
      ...(props.subpath.trim() !== "" ? { subpath: props.subpath.trim() } : {}),
    },
    { onSuccess: (result) => emit("inspected", result) },
  );
}
</script>

<template>
  <div class="repo-source">
    <label class="field">
      <span class="field-label">GitHub repo URL</span>
      <input
        :value="url"
        class="text-input"
        type="url"
        placeholder="https://github.com/owner/repo"
        required
        @input="emit('update:url', ($event.target as HTMLInputElement).value)"
      />
      <span class="field-hint">https://github.com only — the hub refuses everything else.</span>
    </label>
    <div class="field-row">
      <label class="field">
        <span class="field-label">Branch / tag / commit</span>
        <input
          :value="gitRef"
          class="text-input"
          type="text"
          placeholder="main (default: HEAD)"
          @input="emit('update:gitRef', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="field">
        <span class="field-label">Folder in repo</span>
        <input
          :value="subpath"
          class="text-input"
          type="text"
          placeholder="skills/my-skill (empty = repo root)"
          @input="emit('update:subpath', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>
    <div class="inspect-row">
      <button
        type="button"
        class="button"
        :disabled="url.trim() === '' || inspectMutation.isPending.value"
        @click="inspect"
      >
        {{ inspectMutation.isPending.value ? "Inspecting…" : "Inspect" }}
      </button>
      <span v-if="inspected" class="inspect-result">
        Pinned {{ inspected.resolvedSha.slice(0, 7) }} —
        <template v-if="inspected.manifest">vynel-item.json found, form prefilled.</template>
        <template v-else-if="inspected.detectedKind">
          detected a {{ inspected.detectedKind }} ({{ inspected.entryFile }}).
        </template>
        <template v-else>no entry file recognized — check the folder.</template>
      </span>
    </div>
    <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.repo-source {
  display: grid;
  gap: 4px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field-hint {
  color: var(--ink-3);
  font-size: 11.5px;
}

.inspect-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.inspect-result {
  font-size: 11.5px;
  color: var(--ink-2);
}
</style>
