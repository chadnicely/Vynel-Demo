<script setup lang="ts">
import { computed } from "vue";
import type { MetricWidgetContent } from "@vynel/contracts/display/display-widget-content";

// One number, read from across the room. Tone is the only loudness dial —
// `attention` is the room's single alert colour, the same one the strip's
// "Needs you" counter and an attention panel row use.
const props = defineProps<{ content: MetricWidgetContent }>();

const toneClass = computed(() => `is-${props.content.tone ?? "default"}`);
</script>

<template>
  <div class="display-metric" :class="toneClass" data-testid="display-widget-metric">
    <p class="value">{{ props.content.value }}</p>
    <p class="label">{{ props.content.label }}</p>
    <p v-if="props.content.delta" class="delta" data-testid="display-metric-delta">
      {{ props.content.delta }}
    </p>
  </div>
</template>

<style scoped>
.display-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}

.value {
  margin: 0;
  font-size: 30px;
  line-height: 1.1;
  letter-spacing: 0.04em;
  color: var(--display-text, #cdf3ff);
  text-shadow: 0 0 14px rgba(79, 216, 255, 0.45);
}

.label {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
}

.delta {
  margin: 2px 0 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--display-accent, #4fd8ff);
}

.is-attention .value,
.is-attention .delta {
  color: var(--display-attention, #ffc46b);
  text-shadow: 0 0 14px rgba(255, 196, 107, 0.45);
}

.is-live .value,
.is-live .delta {
  color: var(--display-accent, #4fd8ff);
  text-shadow: 0 0 16px rgba(79, 216, 255, 0.7);
}

.is-muted .value,
.is-muted .delta {
  color: var(--display-accent-dim, rgba(79, 216, 255, 0.45));
  text-shadow: none;
}
</style>
