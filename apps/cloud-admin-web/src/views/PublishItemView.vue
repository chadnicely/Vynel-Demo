<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { AdminApiError } from "../lib/admin-api.js";
import { readFileAsBase64 } from "../lib/read-file-base64.js";
import {
  usePublishCatalogVersion,
  type PublishCatalogVersionInput,
} from "../composables/catalog/use-publish-catalog-version.js";

type ItemKind = PublishCatalogVersionInput["item"]["kind"];
// '' stands in for null in the scope <select> (options can't carry null).
type ScopeOption = "" | "user" | "workspace";

const MANIFEST_PREFILLS: Record<ItemKind, string> = {
  skill: '{"kind":"skill","entryFile":"SKILL.md"}',
  agent: '{"kind":"agent","entryFile":"agent.json"}',
  mcp: "{}",
  rule: "{}",
  plugin: "{}",
};

const router = useRouter();
const publishMutation = usePublishCatalogVersion();

const form = reactive({
  itemId: "",
  kind: "skill" as ItemKind,
  displayName: "",
  oneLineDescription: "",
  category: "",
  iconName: "",
  recommendedScope: "user" as ScopeOption,
  minimumTier: "basic" as "basic" | "pro",
  status: "draft" as "draft" | "published",
  version: "",
  changelog: "",
});

const manifestText = ref(MANIFEST_PREFILLS[form.kind]);
// Once the admin touches the manifest it's theirs — switching kind must not
// clobber hand-written JSON, only untouched prefills.
const manifestEdited = ref(false);
watch(
  () => form.kind,
  (kind) => {
    if (!manifestEdited.value) manifestText.value = MANIFEST_PREFILLS[kind];
  },
);

const zipFile = ref<File | null>(null);
const localError = ref<string | null>(null);

const errorMessage = computed(() => {
  if (localError.value !== null) return localError.value;
  const error = publishMutation.error.value;
  if (error === null) return null;
  // 409 = the version already exists, 400 = schema rejection — the hub's
  // message says exactly which; surface it verbatim.
  return error instanceof AdminApiError
    ? error.message
    : "Publishing failed — try again.";
});

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  zipFile.value = input.files?.[0] ?? null;
}

function parseManifest(): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(manifestText.value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the shared error below.
  }
  return null;
}

async function handleSubmit() {
  localError.value = null;
  const manifest = parseManifest();
  if (manifest === null) {
    localError.value = "The manifest must be a JSON object.";
    return;
  }
  if (zipFile.value === null) {
    localError.value = "Pick the artifact zip first.";
    return;
  }
  let artifactBase64: string;
  try {
    artifactBase64 = await readFileAsBase64(zipFile.value);
  } catch (error) {
    localError.value =
      error instanceof Error ? error.message : "Could not read the zip file.";
    return;
  }
  publishMutation.mutate(
    {
      // v1 is curated-only: every item ships under the Vynel Team publisher.
      publisher: {
        id: "vynel-team",
        name: "Vynel Team",
        tier: "verified",
        url: null,
      },
      item: {
        itemId: form.itemId,
        kind: form.kind,
        displayName: form.displayName,
        oneLineDescription: form.oneLineDescription,
        category: form.category,
        iconName: form.iconName,
        recommendedScope:
          form.recommendedScope === "" ? null : form.recommendedScope,
        minimumTier: form.minimumTier,
        status: form.status,
      },
      version: {
        version: form.version,
        changelog: form.changelog,
        manifest,
        minAppVersion: null,
      },
      artifactBase64,
    },
    {
      onSuccess: (published) =>
        void router.push({
          name: "catalog-item",
          params: { itemId: published.itemId },
        }),
    },
  );
}
</script>

<template>
  <section class="publish-view">
    <h1 class="page-title">Publish new item</h1>
    <form class="card" @submit.prevent="handleSubmit">
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
            The desktop app installs skills and agents today; mcp/rule/plugin
            can be published but won't surface in the app yet.
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
      <div class="field-row">
        <label class="field">
          <span class="field-label">Category</span>
          <input v-model="form.category" class="text-input" type="text" required />
        </label>
        <label class="field">
          <span class="field-label">Icon name</span>
          <input v-model="form.iconName" class="text-input" type="text" required />
        </label>
      </div>
      <div class="field-row three">
        <label class="field">
          <span class="field-label">Recommended scope</span>
          <select v-model="form.recommendedScope" class="select-input">
            <option value="user">User</option>
            <option value="workspace">Workspace</option>
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
        <label class="field">
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
      <button
        type="submit"
        class="button button-primary"
        :disabled="publishMutation.isPending.value"
      >
        {{ publishMutation.isPending.value ? "Publishing…" : "Publish item" }}
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
