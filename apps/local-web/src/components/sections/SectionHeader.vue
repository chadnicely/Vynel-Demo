<script setup lang="ts">
import type { Component } from "vue";

// The shared header every canvas section wears: an icon, a title, a one-line
// subtitle, and an optional top-right action (Connect, Sign out, …) via the
// `actions` slot. Extracted so the sections stop each re-implementing it.
defineProps<{
  title: string;
  subtitle?: string;
  icon?: Component;
}>();
</script>

<template>
  <header class="flex items-start gap-2.5 px-1 pb-1">
    <component
      :is="icon"
      v-if="icon"
      :size="15"
      class="mt-0.5 shrink-0 text-ink-2"
    />
    <div class="min-w-0 flex-1">
      <p class="m-0 text-sm font-semibold text-ink-1">{{ title }}</p>
      <p v-if="subtitle" class="m-0 text-xs text-ink-3">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="shrink-0">
      <slot name="actions" />
    </div>
  </header>
</template>
