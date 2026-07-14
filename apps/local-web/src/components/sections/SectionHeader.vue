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
  <header class="flex items-start gap-3 px-0.5 pb-3">
    <span
      v-if="icon"
      class="grid size-9 shrink-0 place-items-center rounded-lg border border-hair bg-panel text-ink-2"
    >
      <component :is="icon" :size="17" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="m-0 text-base font-semibold tracking-tight text-ink-1">
        {{ title }}
      </p>
      <p v-if="subtitle" class="m-0 mt-0.5 text-xs text-ink-2">
        {{ subtitle }}
      </p>
    </div>
    <div v-if="$slots.actions" class="shrink-0 self-center">
      <slot name="actions" />
    </div>
  </header>
</template>
