<script setup lang="ts">
import type { Component } from "vue";
import { ChevronsUpDown } from "lucide-vue-next";
import { workspaceMonogram } from "@vynel/ui";

export interface SidebarItem {
  id: string;
  label: string;
  icon?: Component;
}

// The left navigation, kept simple (Chad: "no special menus"): ONE plain menu
// list — Home / Chat / Sessions ride at the top as regular items (the shell
// puts them there), then the scope's feature sections — and the account pinned
// at the foot. The workspace switcher lives in the title bar. Data-blind —
// the shell owns routing + state.
const props = defineProps<{
  sectionTitle: string;
  sectionItems: SidebarItem[];
  activeSectionId: string | null;
  accountName: string;
}>();

const emit = defineEmits<{
  "select-section": [id: string];
  "open-account": [];
}>();
</script>

<template>
  <nav class="flex h-full flex-col bg-panel">
    <!-- The one menu list -->
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
            :aria-current="item.id === props.activeSectionId ? 'page' : undefined"
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
