<script setup lang="ts">
import type { HubItemStatus } from "@vynel/contracts/hub/catalog";

defineProps<{ status: HubItemStatus }>();
</script>

<template>
  <span class="status-chip" :data-status="status">{{ status }}</span>
</template>

<style scoped>
.status-chip {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  text-transform: capitalize;
  border: 1px solid var(--hair-strong);
  color: var(--ink-2);
}

.status-chip[data-status="published"] {
  background: var(--ok-soft);
  border-color: var(--ok);
  color: var(--ok);
}

.status-chip[data-status="yanked"] {
  background: var(--danger-soft);
  border-color: var(--danger);
  color: var(--danger);
}

.status-chip[data-status="draft"] {
  background: var(--info-soft);
  border-color: var(--info);
  color: var(--info);
}
</style>
