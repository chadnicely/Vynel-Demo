<script setup lang="ts">
import { Lock } from "lucide-vue-next";
import { EmptyState } from "@vynel/ui";

// Stands in for a whole section when the live entitlement lacks its feature —
// a calm invitation, never an error. Deliberately no buy button: purchases
// happen on the provider's platform, not inside the app.
const props = defineProps<{
  featureLabel: string;
}>();
</script>

<template>
  <EmptyState
    title="Part of Vynel Pro"
    :hint="`Your plan includes the basics — ${props.featureLabel} comes with Pro.`"
  >
    <template #icon>
      <Lock :size="22" />
    </template>
    <template #action>
      <p class="provider-note">Upgrades are handled by your Vynel provider.</p>
    </template>
  </EmptyState>
</template>

<style scoped>
.provider-note {
  margin: 0;
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}
</style>
