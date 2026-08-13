<script setup lang="ts">
import {
  PhCaretRight as CaretRight,
  PhCircleNotch as CircleNotch,
  PhHouse as House,
  PhPlus as Plus,
} from "@phosphor-icons/vue";
import { workspaceAccentVar, workspaceMonogram } from "@vynel/ui";
import SidebarAccountRow from "./SidebarAccountRow.vue";
import type { WorkspacePresence } from "../../composables/workspaces/use-workspace-presence.js";

// Menu mode's sidebar root: every scope in one tree — the pinned Global row,
// then the workspace rows with live presence. Clicking a row switches the
// scope and stays here (flip between rooms while watching the canvas); the
// caret drills into that scope's section menu. Data-blind like the strip:
// rows + presence in, events out. (Folders and the projects-root header land
// with the workspace-groups slice — Arc 2b of the redesign plan.)
const props = defineProps<{
  workspaces: { id: string; name: string }[];
  /** The active scope: a workspace id, or null for Global. */
  activeWorkspaceId: string | null;
  presenceByWorkspaceId: Record<string, WorkspacePresence>;
  globalPresence: WorkspacePresence;
  workspaceColorSlots?: Record<string, number | null>;
  accountName: string;
}>();

const emit = defineEmits<{
  /** Switch the scope (null = Global) — the tree stays on screen. */
  select: [workspaceId: string | null];
  /** Switch AND open that scope's section menu. */
  drill: [workspaceId: string | null];
  "create-workspace": [];
  "open-account": [];
}>();

function accent(workspace: { id: string; name: string }): string {
  const customSlot = props.workspaceColorSlots?.[workspace.id];
  if (customSlot !== undefined && customSlot !== null)
    return `var(--ws-${customSlot})`;
  return workspaceAccentVar(workspace.name);
}

function presenceOf(workspaceId: string): WorkspacePresence {
  return props.presenceByWorkspaceId[workspaceId] ?? "idle";
}
</script>

<template>
  <nav class="flex h-full flex-col bg-panel">
    <div class="min-h-0 flex-1 overflow-y-auto py-1.5">
      <ul class="grid gap-px px-2">
        <!-- The pinned Global scope — the tree's anchor, like the strip's. -->
        <li>
          <div
            class="group flex items-center rounded-sm transition"
            :class="
              props.activeWorkspaceId === null
                ? 'bg-row-active text-ink-1'
                : 'text-ink-2 hover:bg-row-hover hover:text-ink-1'
            "
          >
            <button
              type="button"
              aria-label="Open the Global menu"
              class="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
              @click="emit('drill', null)"
            >
              <CaretRight :size="11" />
            </button>
            <button
              type="button"
              class="flex h-8 min-w-0 flex-1 cursor-default items-center gap-2 pr-2 text-left text-sm"
              :aria-current="props.activeWorkspaceId === null ? 'page' : undefined"
              @click="emit('select', null)"
              @dblclick="emit('drill', null)"
            >
              <span class="grid size-5 shrink-0 place-items-center rounded-[4px] bg-[var(--ink-3)] text-white">
                <House :size="12" />
              </span>
              <span class="min-w-0 flex-1 truncate">Global</span>
              <span
                v-if="props.globalPresence === 'attention'"
                aria-label="Waiting on you"
                class="size-2 shrink-0 animate-pulse rounded-full bg-needs-input"
              />
              <CircleNotch
                v-else-if="props.globalPresence === 'working'"
                aria-label="Working"
                :size="12"
                class="shrink-0 animate-spin text-gold"
              />
            </button>
          </div>
        </li>
      </ul>

      <div class="flex items-center gap-1 px-4 pb-0.5 pt-3">
        <p class="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wider text-ink-3">
          Workspaces
        </p>
        <button
          type="button"
          aria-label="New workspace"
          title="New workspace"
          class="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 transition hover:bg-row-hover hover:text-ink-1"
          @click="emit('create-workspace')"
        >
          <Plus :size="12" />
        </button>
      </div>

      <ul class="grid gap-px px-2">
        <li v-for="workspace in props.workspaces" :key="workspace.id">
          <div
            class="group flex items-center rounded-sm transition"
            :class="
              props.activeWorkspaceId === workspace.id
                ? 'bg-row-active text-ink-1'
                : 'text-ink-2 hover:bg-row-hover hover:text-ink-1'
            "
          >
            <button
              type="button"
              :aria-label="`Open the ${workspace.name} menu`"
              class="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
              @click="emit('drill', workspace.id)"
            >
              <CaretRight :size="11" />
            </button>
            <button
              type="button"
              class="flex h-8 min-w-0 flex-1 cursor-default items-center gap-2 pr-2 text-left text-sm"
              :aria-current="props.activeWorkspaceId === workspace.id ? 'page' : undefined"
              @click="emit('select', workspace.id)"
              @dblclick="emit('drill', workspace.id)"
            >
              <span
                class="grid size-5 shrink-0 place-items-center rounded-[4px] text-[10px] font-semibold text-white"
                :style="{ background: accent(workspace) }"
              >
                <CircleNotch
                  v-if="presenceOf(workspace.id) === 'working'"
                  :size="12"
                  class="animate-spin"
                />
                <template v-else>{{ workspaceMonogram(workspace.name) }}</template>
              </span>
              <span class="min-w-0 flex-1 truncate">{{ workspace.name }}</span>
              <span
                v-if="presenceOf(workspace.id) === 'attention'"
                :aria-label="`${workspace.name} is waiting on you`"
                class="size-2 shrink-0 animate-pulse rounded-full bg-needs-input"
              />
            </button>
          </div>
        </li>
      </ul>

      <p
        v-if="props.workspaces.length === 0"
        class="px-4 py-2 text-xs text-ink-3"
      >
        No workspaces yet — create one to get building.
      </p>
    </div>

    <SidebarAccountRow
      :account-name="props.accountName"
      @open-account="emit('open-account')"
    />
  </nav>
</template>
