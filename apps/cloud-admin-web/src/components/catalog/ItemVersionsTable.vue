<script setup lang="ts">
import { ref } from "vue";
import { Copy } from "lucide-vue-next";
import type { HubCatalogVersion } from "@vynel/contracts/hub/catalog";
import { formatBytes, formatDate } from "../../lib/format.js";

defineProps<{ versions: HubCatalogVersion[] }>();

const copiedSha = ref<string | null>(null);
const copyFailedSha = ref<string | null>(null);

async function copySha(sha256: string) {
  try {
    await navigator.clipboard.writeText(sha256);
    copiedSha.value = sha256;
    copyFailedSha.value = null;
  } catch {
    // Clipboard access can be denied (permissions, insecure context) — say
    // so briefly instead of rejecting unhandled.
    copyFailedSha.value = sha256;
    copiedSha.value = null;
  }
  setTimeout(() => {
    if (copiedSha.value === sha256) copiedSha.value = null;
    if (copyFailedSha.value === sha256) copyFailedSha.value = null;
  }, 1500);
}
</script>

<template>
  <div class="card">
    <h2>Versions</h2>
    <p v-if="versions.length === 0" class="muted-note">No versions yet.</p>
    <table v-else class="versions-table">
      <thead>
        <tr>
          <th>Version</th>
          <th>Size</th>
          <th>sha256</th>
          <th>Released</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="version in versions" :key="version.version">
          <td class="mono">{{ version.version }}</td>
          <td>{{ formatBytes(version.artifactSize) }}</td>
          <td class="mono">
            {{ version.artifactSha256.slice(0, 12) }}…
            <button
              type="button"
              class="copy-button"
              :title="
                copiedSha === version.artifactSha256
                  ? 'Copied'
                  : 'Copy full sha256'
              "
              @click="copySha(version.artifactSha256)"
            >
              <Copy :size="13" />
            </button>
            <span v-if="copiedSha === version.artifactSha256" class="copied">
              Copied
            </span>
            <span
              v-else-if="copyFailedSha === version.artifactSha256"
              class="copy-failed"
            >
              Copy failed
            </span>
          </td>
          <td>{{ formatDate(version.releasedAt) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
h2 {
  font-size: 14px;
  margin: 0 0 12px;
}

.versions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th {
  text-align: left;
  color: var(--ink-3);
  font-weight: 500;
  font-size: 12px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--hair-strong);
}

td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--hair);
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

.copy-button {
  background: none;
  border: none;
  color: var(--ink-3);
  cursor: pointer;
  padding: 0 2px;
  vertical-align: middle;
}

.copy-button:hover {
  color: var(--ink-1);
}

.copied {
  color: var(--ok);
  font-size: 11px;
}

.copy-failed {
  color: var(--danger);
  font-size: 11px;
}
</style>
