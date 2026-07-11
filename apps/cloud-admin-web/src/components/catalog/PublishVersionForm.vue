<script setup lang="ts">
import { computed, ref } from "vue";
import type { HubAdminCatalogItem } from "@vynel/contracts/hub/admin";
import { AdminApiError } from "../../lib/admin-api.js";
import { readFileAsBase64 } from "../../lib/read-file-base64.js";
import { usePublishCatalogVersion } from "../../composables/catalog/use-publish-catalog-version.js";

const props = defineProps<{ item: HubAdminCatalogItem }>();

const publishMutation = usePublishCatalogVersion();

const version = ref("");
const changelog = ref("");
const manifestText = ref('{"entry":"SKILL.md"}');
const zipFile = ref<File | null>(null);
// File inputs aren't v-model-able — the DOM node must be cleared by hand
// after a publish, or it keeps showing the old filename.
const zipFileInput = ref<HTMLInputElement | null>(null);
const localError = ref<string | null>(null);
const publishedVersion = ref<string | null>(null);

const errorMessage = computed(() => {
  if (localError.value !== null) return localError.value;
  const error = publishMutation.error.value;
  if (error === null) return null;
  // 409 = byte-immutability conflict, 400 = schema rejection — the hub's
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
  publishedVersion.value = null;
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
        itemId: props.item.itemId,
        kind: props.item.kind,
        displayName: props.item.displayName,
        oneLineDescription: props.item.oneLineDescription,
        category: props.item.category,
        iconName: props.item.iconName,
        recommendedScope: props.item.recommendedScope,
        minimumTier: props.item.minimumTier,
        status: props.item.status,
      },
      version: {
        version: version.value,
        changelog: changelog.value,
        manifest,
        minAppVersion: null,
      },
      artifactBase64,
    },
    {
      onSuccess: (published) => {
        publishedVersion.value = published.version;
        version.value = "";
        changelog.value = "";
        zipFile.value = null;
        if (zipFileInput.value !== null) zipFileInput.value.value = "";
      },
    },
  );
}
</script>

<template>
  <form class="card" @submit.prevent="handleSubmit">
    <h2>Publish new version</h2>
    <div class="field-row">
      <label class="field">
        <span class="field-label">Version (semver)</span>
        <input
          v-model="version"
          class="text-input"
          type="text"
          placeholder="1.0.0"
          required
        />
      </label>
      <label class="field">
        <span class="field-label">Artifact zip</span>
        <input
          ref="zipFileInput"
          class="text-input"
          type="file"
          accept=".zip"
          @change="handleFileChange"
        />
      </label>
    </div>
    <label class="field">
      <span class="field-label">Changelog</span>
      <textarea v-model="changelog" class="textarea-input"></textarea>
    </label>
    <label class="field">
      <span class="field-label">Manifest (JSON)</span>
      <textarea v-model="manifestText" class="textarea-input mono"></textarea>
    </label>
    <button
      type="submit"
      class="button button-primary"
      :disabled="publishMutation.isPending.value"
    >
      {{ publishMutation.isPending.value ? "Publishing…" : "Publish version" }}
    </button>
    <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
    <p v-else-if="publishedVersion" class="form-success">
      Published {{ publishedVersion }}.
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

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}
</style>
