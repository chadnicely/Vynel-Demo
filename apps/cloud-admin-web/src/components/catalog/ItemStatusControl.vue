<script setup lang="ts">
import { computed, ref } from "vue";
import type { HubAdminCatalogItem } from "@vynel/contracts/hub/admin";
import type { HubItemStatus } from "@vynel/contracts/hub/catalog";
import { AdminApiError } from "../../lib/admin-api.js";
import { useSetCatalogItemStatus } from "../../composables/catalog/use-set-catalog-item-status.js";

const props = defineProps<{ item: HubAdminCatalogItem }>();

const statusMutation = useSetCatalogItemStatus();

// Yank gets a two-step inline confirm: it stops distribution instantly
// (browse AND download refuse the item the moment it lands).
const confirmingYank = ref(false);

const errorMessage = computed(() => {
  const error = statusMutation.error.value;
  if (error === null) return null;
  return error instanceof AdminApiError
    ? error.message
    : "The status change failed — try again.";
});

function setStatus(status: HubItemStatus) {
  confirmingYank.value = false;
  statusMutation.mutate({ itemId: props.item.itemId, status });
}
</script>

<template>
  <div class="card">
    <h2>Status</h2>
    <div v-if="confirmingYank" class="confirm-row">
      <span class="confirm-text">
        Yanking stops distribution instantly — installed copies keep working.
      </span>
      <button
        type="button"
        class="button button-danger"
        :disabled="statusMutation.isPending.value"
        @click="setStatus('yanked')"
      >
        Confirm yank
      </button>
      <button type="button" class="button" @click="confirmingYank = false">
        Cancel
      </button>
    </div>
    <div v-else class="button-row">
      <button
        type="button"
        class="button button-primary"
        :disabled="
          item.status === 'published' || statusMutation.isPending.value
        "
        @click="setStatus('published')"
      >
        Publish
      </button>
      <button
        type="button"
        class="button button-danger"
        :disabled="item.status === 'yanked' || statusMutation.isPending.value"
        @click="confirmingYank = true"
      >
        Yank
      </button>
      <button
        type="button"
        class="button"
        :disabled="item.status === 'draft' || statusMutation.isPending.value"
        @click="setStatus('draft')"
      >
        Back to draft
      </button>
    </div>
    <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
h2 {
  font-size: 14px;
  margin: 0 0 12px;
}

.button-row,
.confirm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.confirm-text {
  color: var(--danger);
  font-size: 12.5px;
}
</style>
