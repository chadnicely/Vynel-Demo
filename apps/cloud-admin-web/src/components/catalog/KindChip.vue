<script setup lang="ts">
import type { HubItemKind } from "@vynel/contracts/hub/catalog";

defineProps<{ kind: HubItemKind }>();
</script>

<template>
  <span class="kind-chip">{{ kind }}</span>
</template>

<style scoped>
.kind-chip {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-family: var(--font-mono);
  border: 1px solid var(--hair-strong);
  background: var(--bg-raised);
  color: var(--ink-2);
}
</style>
