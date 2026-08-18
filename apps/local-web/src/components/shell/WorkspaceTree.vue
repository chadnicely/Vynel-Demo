<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  PhCaretDown as CaretDown,
  PhCaretRight as CaretRight,
  PhCircleNotch as CircleNotch,
  PhHouse as House,
  PhPlus as Plus,
  PhSquaresFour as SquaresFour,
} from "@phosphor-icons/vue";
import { ContextMenu } from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";
import SidebarAccountRow from "./SidebarAccountRow.vue";
import WorkspaceTreeRow from "./WorkspaceTreeRow.vue";
import type { WorkspaceStatusView } from "../../composables/workspaces/use-workspace-status.js";

// Menu mode's sidebar root — the canvas's workspace tree: the pinned Global
// row, the user's groups and ungrouped workspaces (ALIVE rows — running, in
// a state, or holding open tasks), then the collapsible NOT RUNNING group
// for parked rows (quiet + nothing open), then the "New workspace" row. Rows
// drag into groups (or back to the root zone); a group's context menu
// renames inline or deletes (members detach, never deleted — the engine
// enforces it). Each group header carries its own "+", which opens the
// create dialog pre-filed into that group; new groups are made from the
// dialog (Kafi, 2026-08-19 — the Global row keeps only its own status).
// Row click opens that workspace's chat; the caret drills. Data-blind: rows
// + groups + status views in, events out.
const props = defineProps<{
  workspaces: {
    id: string;
    name: string;
    groupId: string | null;
    imageUrl?: string | null;
    accentVar?: string;
  }[];
  groups: { id: string; name: string }[];
  /** The active scope: a workspace id, or null for Global. */
  activeWorkspaceId: string | null;
  statusByWorkspaceId: Record<string, WorkspaceStatusView>;
  globalStatus: WorkspaceEffectiveStatus;
  accountName: string;
}>();

const emit = defineEmits<{
  /** Switch the scope (null = Global) — the tree stays on screen. */
  select: [workspaceId: string | null];
  /** Switch AND open that scope's section menu. */
  drill: [workspaceId: string | null];
  /** Open the create dialog — pre-filed into a group, or null for the root. */
  "create-workspace": [groupId: string | null];
  "rename-group": [groupId: string, name: string];
  "delete-group": [groupId: string];
  "move-workspace": [workspaceId: string, groupId: string | null];
  "open-account": [];
}>();

function statusViewOf(workspaceId: string): WorkspaceStatusView | null {
  return props.statusByWorkspaceId[workspaceId] ?? null;
}

// Parked = the canvas's NOT RUNNING vocabulary, mapped honestly: nothing in
// flight, no state set, and no open tasks left on its list.
function isParked(workspaceId: string): boolean {
  const view = statusViewOf(workspaceId);
  if (view === null) return true;
  return view.status === "not_running" && view.tasksDone >= view.tasksTotal;
}

// Foldered rows ALWAYS render inside their folder (a parked member dims in
// place — hiding it elsewhere would scramble membership); only UNGROUPED
// parked rows collect under NOT RUNNING.
const membersByGroupId = computed(() => {
  const members = new Map<string, typeof props.workspaces>();
  for (const workspace of props.workspaces) {
    if (workspace.groupId === null) continue;
    const bucket = members.get(workspace.groupId) ?? [];
    bucket.push(workspace);
    members.set(workspace.groupId, bucket);
  }
  return members;
});
const ungroupedWorkspaces = computed(() => {
  const groupIds = new Set(props.groups.map((group) => group.id));
  // A groupId whose folder is gone (stale cache mid-refetch) renders at the
  // root rather than vanishing.
  return props.workspaces.filter(
    (workspace) => workspace.groupId === null || !groupIds.has(workspace.groupId),
  );
});
const rootWorkspaces = computed(() =>
  ungroupedWorkspaces.value.filter((workspace) => !isParked(workspace.id)),
);
const parkedWorkspaces = computed(() =>
  ungroupedWorkspaces.value.filter((workspace) => isParked(workspace.id)),
);

// ── Folder fold state — persisted like the sidebar's group folds. ──
const FOLDS_STORAGE_KEY = "vynel.tree.collapsed-folders";
function readCollapsed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FOLDS_STORAGE_KEY) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}
const collapsedFolderIds = ref<Set<string>>(readCollapsed());
function toggleFolder(groupId: string) {
  const next = new Set(collapsedFolderIds.value);
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  collapsedFolderIds.value = next;
  localStorage.setItem(FOLDS_STORAGE_KEY, JSON.stringify([...next]));
}

// The NOT RUNNING fold — OPEN by default (nothing may silently disappear on
// day one; the canvas's collapsed resting state is one click away),
// persisted alongside the folder folds.
const PARKED_STORAGE_KEY = "vynel.tree.not-running-open";
const isParkedOpen = ref(localStorage.getItem(PARKED_STORAGE_KEY) !== "false");
function toggleParked() {
  isParkedOpen.value = !isParkedOpen.value;
  localStorage.setItem(PARKED_STORAGE_KEY, String(isParkedOpen.value));
}

// ── Drag and drop — native HTML5, the canvas's own pattern. The tree owns
// the state; a drop emits and the server answer re-renders membership. ──
const draggingWorkspaceId = ref<string | null>(null);
const dropTargetId = ref<string | "root" | null>(null);

function onFolderDragOver(event: DragEvent, groupId: string) {
  if (draggingWorkspaceId.value === null) return;
  event.preventDefault();
  dropTargetId.value = groupId;
}
function onRootDragOver(event: DragEvent) {
  if (draggingWorkspaceId.value === null) return;
  event.preventDefault();
  dropTargetId.value = "root";
}
function onDrop(groupId: string | null) {
  const workspaceId = draggingWorkspaceId.value;
  draggingWorkspaceId.value = null;
  dropTargetId.value = null;
  if (workspaceId === null) return;
  const current = props.workspaces.find((w) => w.id === workspaceId)?.groupId ?? null;
  if (current !== groupId) emit("move-workspace", workspaceId, groupId);
}

// ── Inline folder rename (context menu or double-click → input swap). The
// ref lives inside v-for, so Vue collects it as an ARRAY — only one input
// ever renders (v-if on the editing id), hence [0]. ──
const editingGroupId = ref<string | null>(null);
const editingName = ref("");
const renameInput = ref<HTMLInputElement[]>([]);
function startRename(group: { id: string; name: string }) {
  editingGroupId.value = group.id;
  editingName.value = group.name;
  void nextTick(() => {
    const input = renameInput.value[0];
    // Explicit focus — select() alone doesn't move focus per spec.
    input?.focus();
    input?.select();
  });
}
function commitRename() {
  const groupId = editingGroupId.value;
  const name = editingName.value.trim();
  editingGroupId.value = null;
  if (groupId !== null && name.length > 0) emit("rename-group", groupId, name);
}

const FOLDER_MENU: MenuItemModel[] = [
  { id: "rename", label: "Rename group" },
  { id: "delete", label: "Delete group", danger: true },
];
function onFolderMenu(group: { id: string; name: string }, itemId: string) {
  if (itemId === "rename") startRename(group);
  else if (itemId === "delete") emit("delete-group", group.id);
}
</script>

<template>
  <!-- The canvas's sidebar column: on `--color-bg` (flush with the canvas, a
       hairline apart), the container itself padded `16.8px 8.4px` so every
       child — the parked group and the account foot included — sits inset. -->
  <nav class="flex h-full flex-col bg-[var(--color-bg)] px-[8.4px] py-[16.8px] text-[12.5px]">
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ul class="my-0 grid list-none gap-1 pl-0">
        <!-- The pinned Global scope — the tree's anchor, like the strip's.
             It carries only its own status; creating lives on the groups
             and the "New workspace" row below. -->
        <li>
          <div
            class="group flex items-center rounded-sm pl-[10px] pr-[7px] transition"
            :class="
              props.activeWorkspaceId === null
                ? 'bg-[var(--color-accent-900)] text-[var(--color-accent-100)]'
                : 'text-ink-2 hover:bg-row-hover hover:text-ink-1'
            "
          >
            <button
              type="button"
              aria-label="Open the Global menu"
              class="tree-caret grid w-3 shrink-0 self-stretch place-items-center rounded-sm text-[var(--color-neutral-600)] transition hover:text-ink-1"
              @click="emit('drill', null)"
            >
              <CaretRight :size="10" />
            </button>
            <button
              type="button"
              class="ml-2 grid min-h-8 min-w-0 flex-1 cursor-default grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-left text-[12.5px]"
              :aria-current="props.activeWorkspaceId === null ? 'page' : undefined"
              @click="emit('select', null)"
              @dblclick="emit('drill', null)"
            >
              <span class="grid size-4 place-items-center rounded-[4px] bg-[var(--ink-3)] text-white">
                <House :size="10" />
              </span>
              <span class="min-w-0 truncate">Global</span>
              <span class="flex items-center gap-[7px]">
                <span
                  v-if="props.globalStatus === 'needs_input'"
                  aria-label="Waiting on you"
                  class="size-2 shrink-0 animate-pulse rounded-full bg-needs-input"
                />
                <CircleNotch
                  v-else-if="props.globalStatus === 'running'"
                  aria-label="Working"
                  :size="12"
                  class="shrink-0 animate-spin text-gold"
                />
              </span>
            </button>
          </div>
        </li>
      </ul>

      <!-- Groups (alive members). Dashed border only while a drag hovers —
           the canvas's drop-target treatment. -->
      <div class="mt-1.5 grid gap-1.5">
        <div
          v-for="group in props.groups"
          :key="group.id"
          class="rounded-sm border border-dashed transition"
          :class="
            dropTargetId === group.id
              ? 'border-gold bg-gold-soft'
              : 'border-transparent'
          "
          @dragover="onFolderDragOver($event, group.id)"
          @dragleave="dropTargetId = dropTargetId === group.id ? null : dropTargetId"
          @drop="onDrop(group.id)"
        >
          <ContextMenu :items="FOLDER_MENU" @select="(id) => onFolderMenu(group, id)">
            <div
              class="tree-group-header mb-1 flex w-full items-center border-b border-hair-strong pl-[7px] pr-[5px] text-ink-1"
            >
              <button
                type="button"
                :aria-expanded="!collapsedFolderIds.has(group.id)"
                class="flex min-w-0 flex-1 cursor-default items-center gap-2 py-[5px] text-left text-[12px] font-semibold transition hover:text-ink-1"
                @click="toggleFolder(group.id)"
              >
                <component
                  :is="collapsedFolderIds.has(group.id) ? CaretRight : CaretDown"
                  :size="10"
                  class="shrink-0 text-[var(--color-neutral-600)]"
                />
                <!-- A GROUP of workspaces — the collection glyph, never a
                     folder (folders mean files everywhere else now). -->
                <SquaresFour :size="13" weight="duotone" class="shrink-0 text-[var(--color-neutral-400)]" />
                <input
                  v-if="editingGroupId === group.id"
                  ref="renameInput"
                  v-model="editingName"
                  maxlength="60"
                  :aria-label="`Rename ${group.name}`"
                  class="min-w-0 flex-1 rounded-sm bg-inset px-1 text-[12px] text-ink-1 outline-none"
                  @keydown.enter.prevent="commitRename"
                  @keydown.esc.prevent="editingGroupId = null"
                  @blur="commitRename"
                  @click.stop
                />
                <span
                  v-else
                  class="min-w-0 flex-1 truncate"
                  @dblclick.stop="startRename(group)"
                  >{{ group.name }}</span
                >
                <span class="shrink-0 text-[10.5px] font-normal text-[var(--color-neutral-600)]">
                  {{ membersByGroupId.get(group.id)?.length ?? 0 }}
                </span>
              </button>
              <button
                type="button"
                :aria-label="`New workspace in ${group.name}`"
                :title="`New workspace in ${group.name}`"
                class="tree-group-add ml-1 grid size-5 shrink-0 cursor-default place-items-center rounded-sm text-[var(--color-neutral-500)] transition hover:bg-row-hover hover:text-[var(--color-accent)]"
                @click.stop="emit('create-workspace', group.id)"
              >
                <Plus :size="12" weight="bold" />
              </button>
            </div>
          </ContextMenu>
          <!-- No child inset: a group's rows share the header's left rail,
               the way the mission-control prototype's groups do. The header
               above already says they are nested. -->
          <ul
            v-if="!collapsedFolderIds.has(group.id)"
            class="my-0 grid list-none gap-0.5 pl-0"
          >
            <li v-for="workspace in membersByGroupId.get(group.id) ?? []" :key="workspace.id">
              <WorkspaceTreeRow
                :workspace="workspace"
                :is-active="props.activeWorkspaceId === workspace.id"
                :status-view="statusViewOf(workspace.id)"
                @select="emit('select', workspace.id)"
                @drill="emit('drill', workspace.id)"
                @drag-start="draggingWorkspaceId = workspace.id"
                @drag-end="((draggingWorkspaceId = null), (dropTargetId = null))"
              />
            </li>
          </ul>
        </div>
      </div>

      <!-- The root zone — ungrouped alive rows; a drop here detaches. -->
      <ul
        class="mt-1 mb-0 grid list-none gap-0.5 rounded-sm border border-dashed p-0.5 pl-0.5 transition"
        :class="dropTargetId === 'root' ? 'border-gold bg-gold-soft' : 'border-transparent'"
        @dragover="onRootDragOver"
        @dragleave="dropTargetId = dropTargetId === 'root' ? null : dropTargetId"
        @drop="onDrop(null)"
      >
        <li v-for="workspace in rootWorkspaces" :key="workspace.id">
          <WorkspaceTreeRow
            :workspace="workspace"
            :is-active="props.activeWorkspaceId === workspace.id"
            :status-view="statusViewOf(workspace.id)"
            @select="emit('select', workspace.id)"
            @drill="emit('drill', workspace.id)"
            @drag-start="draggingWorkspaceId = workspace.id"
            @drag-end="((draggingWorkspaceId = null), (dropTargetId = null))"
          />
        </li>
      </ul>

      <!-- NOT RUNNING — the canvas's parked group: quiet rooms with nothing
           open, collapsed by default. -->
      <template v-if="parkedWorkspaces.length > 0">
        <button
          type="button"
          :aria-expanded="isParkedOpen"
          class="mt-[8.4px] flex w-full cursor-default items-center gap-2 pb-[5px] pl-[10px] pr-[11.2px] pt-[7px] text-left text-[10px] uppercase tracking-[0.12em] text-[var(--color-neutral-600)] transition hover:text-[var(--color-accent)]"
          data-testid="tree-not-running"
          @click="toggleParked"
        >
          <component :is="isParkedOpen ? CaretDown : CaretRight" :size="10" class="shrink-0" />
          Not running
          <span class="flex-1" />
          <span class="text-[10.5px] normal-case tracking-normal">{{
            parkedWorkspaces.length
          }}</span>
        </button>
        <ul v-if="isParkedOpen" class="my-0 grid list-none gap-0.5 pl-0">
          <li v-for="workspace in parkedWorkspaces" :key="workspace.id">
            <WorkspaceTreeRow
              :workspace="workspace"
              :is-active="props.activeWorkspaceId === workspace.id"
              :status-view="statusViewOf(workspace.id)"
              @select="emit('select', workspace.id)"
              @drill="emit('drill', workspace.id)"
              @drag-start="draggingWorkspaceId = workspace.id"
              @drag-end="((draggingWorkspaceId = null), (dropTargetId = null))"
            />
          </li>
        </ul>
      </template>

      <p
        v-if="props.workspaces.length === 0"
        class="px-[10px] py-2 text-[12px] text-[var(--color-neutral-600)]"
      >
        No workspaces yet — create one to get building.
      </p>

      <button
        type="button"
        class="tree-new-workspace mt-2 flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pl-[10px] pr-[9px] text-left text-[12px] text-[var(--color-neutral-500)] transition hover:bg-row-hover hover:text-ink-1"
        @click="emit('create-workspace', null)"
      >
        <span class="grid w-3 shrink-0 place-items-center"><Plus :size="12" weight="bold" /></span>
        <span class="ml-2">New workspace</span>
      </button>
    </div>

    <SidebarAccountRow
      :account-name="props.accountName"
      @open-account="emit('open-account')"
    />
  </nav>
</template>

<style scoped>
/* The caret's LAYOUT column is the canvas's 12px, but a 12px-wide target is
   half of WCAG 2.5.8's 24x24 floor and drill-in has no other single-click
   path. The hit area grows LEFT into the row's own padding — growing it
   evenly would overlap the label button (a positioned ::after paints above
   its unpositioned sibling) and steal clicks meant for "select". */
.tree-caret {
  position: relative;
}

.tree-caret::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -10px;
  width: 24px;
}
</style>
