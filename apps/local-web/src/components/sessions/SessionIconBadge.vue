<script setup lang="ts">
import { computed } from "vue";
import { workspaceAccentVar, workspaceMonogram } from "@vynel/ui";
import { sessionIconComponent } from "./session-icon-catalog.js";

// The session's face — the workspace tree row's 18px identity square, per
// conversation: the curated icon the assistant stamped at spawn, else the
// name's monogram. The accent derives from the NAME (the workspace-color
// discipline — derived, never stored), so a session wears the same hue on
// every surface that names it.
const props = defineProps<{
  name: string;
  icon?: string | null;
}>();

const glyph = computed(() => sessionIconComponent(props.icon ?? null));
const monogram = computed(() => workspaceMonogram(props.name));
const accent = computed(() => workspaceAccentVar(props.name));
</script>

<template>
  <span
    class="session-icon grid size-[18px] shrink-0 place-items-center overflow-hidden rounded-[5px] text-[8px] font-bold leading-none"
    :style="{
      background: `color-mix(in srgb, ${accent} 30%, transparent)`,
      color: accent,
    }"
    aria-hidden="true"
  >
    <component :is="glyph" v-if="glyph" :size="11" weight="bold" />
    <span v-else>{{ monogram }}</span>
  </span>
</template>
