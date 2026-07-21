<script setup lang="ts">
import type { Component } from "vue";
import { ChevronsUpDown } from "lucide-vue-next";
import { workspaceMonogram } from "@vynel/ui";

export interface SidebarItem {
  id: string;
  label: string;
  icon?: Component;
}

// The left navigation, Claude-Desktop-shaped: Home / Chat / Sessions as a
// full-width segmented mode toggle up top, the contextual section list, and the
// account pinned at the foot. The workspace switcher lives in the title bar.
// Data-blind — the shell owns routing + state.
const props = defineProps<{
  surface: "home" | "chat" | "sessions" | "workspace";
  sectionTitle: string;
  sectionItems: SidebarItem[];
  activeSectionId: string | null;
  accountName: string;
}>();

const emit = defineEmits<{
  "select-surface": [id: string];
  "select-section": [id: string];
  "open-account": [];
}>();

const SURFACE_TABS = [
  { id: "home", label: "Home" },
  { id: "chat", label: "Chat" },
  { id: "sessions", label: "Sessions" },
];
</script>

<template>
  <nav class="flex h-full flex-col bg-panel">
    <!-- Home / Chat / Sessions mode toggle (full-width segmented control) -->
    <div class="p-2">
      <div
        class="flex gap-0.5 rounded-md border border-hair bg-shell p-0.5"
        role="tablist"
      >
        <button
          v-for="tab in SURFACE_TABS"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="props.surface === tab.id"
          class="flex-1 cursor-default rounded-sm px-2 py-1 text-sm transition"
          :class="
            props.surface === tab.id
              ? 'bg-raised font-medium text-ink-1 shadow-raised'
              : 'text-ink-2 hover:text-ink-1'
          "
          @click="emit('select-surface', tab.id)"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- Contextual sections -->
    <div
      v-if="props.sectionItems.length > 0"
      class="min-h-0 flex-1 overflow-y-auto"
    >
      <p class="px-4 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-ink-3">
        {{ props.sectionTitle }}
      </p>
      <ul class="grid gap-0.5 px-2">
        <li v-for="item in props.sectionItems" :key="item.id">
          <button
            type="button"
            class="flex w-full cursor-default items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-sm transition"
            :class="
              item.id === props.activeSectionId
                ? 'bg-row-active font-medium text-ink-1'
                : 'text-ink-2 hover:bg-row-hover hover:text-ink-1'
            "
            @click="emit('select-section', item.id)"
          >
            <component :is="item.icon" v-if="item.icon" class="size-4 shrink-0 text-ink-3" />
            <span class="flex-1 truncate">{{ item.label }}</span>
          </button>
        </li>
      </ul>
    </div>
    <div v-else class="flex-1" />

    <!-- Account (pinned foot) -->
    <button
      type="button"
      class="flex w-full cursor-default items-center gap-2.5 border-t border-hair px-3 py-2.5 text-left transition hover:bg-row-hover"
      @click="emit('open-account')"
    >
      <span class="grid size-6 shrink-0 place-items-center rounded-full bg-claude-soft text-2xs font-semibold text-claude">
        {{ workspaceMonogram(props.accountName) }}
      </span>
      <span class="min-w-0 flex-1 truncate text-sm text-ink-1">{{ props.accountName }}</span>
      <ChevronsUpDown :size="14" class="shrink-0 text-ink-3" />
    </button>
  </nav>
</template>
