<script setup lang="ts">
import { ref } from "vue";
import { usePublishItemForm } from "../composables/catalog/use-publish-item-form.js";
import CategorySelect from "../components/catalog/CategorySelect.vue";
import IconPicker from "../components/catalog/IconPicker.vue";
import PublisherPicker from "../components/catalog/PublisherPicker.vue";
import RepoSourceFields from "../components/catalog/RepoSourceFields.vue";

// Layout only — the whole form state machine (both artifact sources, the
// inspect prefill, submit dispatch) lives in use-publish-item-form.ts.
const publisherPicker = ref<InstanceType<typeof PublisherPicker> | null>(null);

const {
  sourceMode,
  repoUrl,
  repoRef,
  repoSubpath,
  form,
  publisher,
  manifestText,
  manifestEdited,
  isPending,
  errorMessage,
  handleFileChange,
  applyInspectPrefill,
  handleSubmit,
} = usePublishItemForm({
  onPublisherPrefill: (prefill) => publisherPicker.value?.applyPrefill(prefill),
});
</script>

<template>
  <section class="publish-view">
    <h1 class="page-title">Add Marketplace Catalog</h1>
    <form class="card" @submit.prevent="handleSubmit">
      <div class="mode-toggle" role="radiogroup" aria-label="Artifact source">
        <button
          type="button"
          class="button"
          :class="{ 'button-primary': sourceMode === 'zip' }"
          :aria-pressed="sourceMode === 'zip'"
          @click="sourceMode = 'zip'"
        >
          Upload zip
        </button>
        <button
          type="button"
          class="button"
          :class="{ 'button-primary': sourceMode === 'repo' }"
          :aria-pressed="sourceMode === 'repo'"
          @click="sourceMode = 'repo'"
        >
          From GitHub URL
        </button>
      </div>

      <RepoSourceFields
        v-if="sourceMode === 'repo'"
        v-model:url="repoUrl"
        v-model:git-ref="repoRef"
        v-model:subpath="repoSubpath"
        @inspected="applyInspectPrefill"
      />

      <div class="field-row">
        <label class="field">
          <span class="field-label">Item id</span>
          <input
            v-model="form.itemId"
            class="text-input"
            type="text"
            placeholder="daily-briefing"
            required
          />
          <span class="field-hint">kebab-case, e.g. daily-briefing</span>
        </label>
        <label class="field">
          <span class="field-label">Kind</span>
          <select v-model="form.kind" class="select-input">
            <option value="skill">Skill</option>
            <option value="agent">Agent</option>
            <option value="mcp">MCP</option>
            <option value="rule">Rule</option>
            <option value="plugin">Plugin</option>
          </select>
          <span class="field-hint">
            Repo folders follow the seed-bundle layout — the kind's entry
            file (SKILL.md, agent.json, …) sits at the folder root.
          </span>
        </label>
      </div>
      <label class="field">
        <span class="field-label">Display name</span>
        <input v-model="form.displayName" class="text-input" type="text" required />
      </label>
      <label class="field">
        <span class="field-label">One-line description</span>
        <input
          v-model="form.oneLineDescription"
          class="text-input"
          type="text"
          required
        />
      </label>
      <div class="field">
        <span class="field-label">Publisher</span>
        <PublisherPicker ref="publisherPicker" v-model="publisher" />
      </div>
      <div class="field">
        <span class="field-label">Category</span>
        <CategorySelect v-model="form.category" />
      </div>
      <div class="field">
        <span class="field-label">Icon</span>
        <IconPicker v-model="form.iconName" :fallback-text="form.displayName" />
      </div>
      <label class="field">
        <span class="field-label">Source URL</span>
        <!-- The credit line's upstream-origin link. Empty = first-party for
             zip publishes; repo publishes derive the pinned folder link. -->
        <input
          v-model="form.sourceUrl"
          class="text-input"
          type="url"
          placeholder="https://github.com/…"
        />
      </label>
      <div class="field-row three">
        <label class="field">
          <span class="field-label">Recommended scope</span>
          <select v-model="form.recommendedScope" class="select-input">
            <option value="user">User</option>
            <option value="workspace">Workspace</option>
            <option value="both">User and workspace</option>
            <option value="">None</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Minimum tier</span>
          <select v-model="form.minimumTier" class="select-input">
            <option value="basic">Basic</option>
            <option value="pro">Pro</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Status</span>
          <select v-model="form.status" class="select-input">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <span class="field-hint">
            Draft items stay invisible to users until published.
          </span>
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span class="field-label">Version (semver)</span>
          <input
            v-model="form.version"
            class="text-input"
            type="text"
            placeholder="1.0.0"
            required
          />
        </label>
        <label v-if="sourceMode === 'zip'" class="field">
          <span class="field-label">Artifact zip</span>
          <input
            class="text-input"
            type="file"
            accept=".zip"
            @change="handleFileChange"
          />
        </label>
      </div>
      <label class="field">
        <span class="field-label">Changelog</span>
        <textarea v-model="form.changelog" class="textarea-input"></textarea>
      </label>
      <label class="field">
        <span class="field-label">Manifest (JSON)</span>
        <textarea
          v-model="manifestText"
          class="textarea-input mono"
          @input="manifestEdited = true"
        ></textarea>
      </label>
      <button type="submit" class="button button-primary" :disabled="isPending">
        {{ isPending ? "Publishing…" : "Publish item" }}
      </button>
      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
    </form>
  </section>
</template>

<style scoped>
.publish-view {
  max-width: 720px;
}

.page-title {
  font-size: 17px;
  margin: 0 0 16px;
}

.mode-toggle {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field-row.three {
  grid-template-columns: 1fr 1fr 1fr;
}

.field-hint {
  color: var(--ink-3);
  font-size: 11.5px;
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}
</style>
