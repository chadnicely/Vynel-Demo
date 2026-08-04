<script setup lang="ts">
import { PresenceDot } from "@vynel/ui";

// The "working…" strip above the composer, reduced to the NON-DELEGATION
// origin note ("Replying on Telegram…") — the per-delegation Watch/Stop chips
// dissolved into the thread's live persona cards (persona-sessions B5).
const props = defineProps<{
  /** A non-delegation background turn's origin note. Null hides the strip. */
  backgroundTurnLabel: string | null;
}>();
</script>

<template>
  <div v-if="props.backgroundTurnLabel" class="processing-banner">
    <span class="processing-chip">
      <PresenceDot state="live" />
      <span>{{ props.backgroundTurnLabel }}</span>
    </span>
  </div>
</template>

<style scoped>
.processing-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 968px;
  width: 100%;
  margin: 0 auto;
  padding: 4px 24px 8px;
}

.processing-chip {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  color: var(--ink-2);
  font: 500 11.5px/1.5 var(--font-ui);
}
</style>
