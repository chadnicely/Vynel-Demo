<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  PhCaretDown as CaretDown,
  PhCaretRight as CaretRight,
  PhCircleNotch as CircleNotch,
  PhFolder as Folder,
  PhFolderOpen as FolderOpen,
  PhFolderPlus as FolderPlus,
  PhHouse as House,
  PhPlus as Plus,
} from "@phosphor-icons/vue";
import { ContextMenu } from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";
import SidebarAccountRow from "./SidebarAccountRow.vue";
import WorkspaceTreeRow from "./WorkspaceTreeRow.vue";
import type { WorkspaceStatusView } from "../../composables/workspaces/use-workspace-status.js";

// Menu mode's sidebar root — the canvas's workspace tree: the pinned Global
// row, the user's folders and ungrouped workspaces (ALIVE rows — running, in
// a state, or holding open tasks), then the collapsible NOT RUNNING group
// for parked rows (quiet + nothing open). Rows drag into folders (or back to
// the root zone); a folder's context menu renames inline or deletes (members
// detach, never deleted — the engine enforces it). Row click switches scope
// and stays here; the caret drills. Data-blind: rows + groups + status views
// in, events out.
const props = defineProps<{
  workspaces: { id: string; name: string; groupId: string | null }[];
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
  "create-workspace": [];
  "create-group": [];
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
  { id: "rename", label: "Rename folder" },
  { id: "delete", label: "Delete folder", danger: true },
];
function onFolderMenu(group: { id: string; name: string }, itemId: string) {
  if (itemId === "rename") startRename(group);
  else if (itemId === "delete") emit("delete-group", group.id);
}
</script>

<template>
  <nav class="flex h-full flex-col bg-panel">
    <div class="min-h-0 flex-1 overflow-y-auto py-1.5">
      <ul class="grid list-none gap-[5px] px-2">
        <!-- The pinned Global scope — the tree's anchor, like the strip's. -->
        <li>
          <div
            class="group flex items-center rounded-sm transition"
            :class="
              props.activeWorkspaceId === null
                ? 'bg-[var(--color-accent-900)] text-[var(--color-accent-100)]'
                : 'text-ink-2 hover:bg-row-hover hover:text-ink-1'
            "
          >
            <button
              type="button"
              aria-label="Open the Global menu"
              class="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 transition hover:text-ink-1"
              @click="emit('drill', null)"
            >
              <CaretRight :size="11" />
            </button>
            <button
              type="button"
              class="flex h-8 min-w-0 flex-1 cursor-default items-center gap-2 pr-2 text-left text-[12.5px]"
              :aria-current="props.activeWorkspaceId === null ? 'page' : undefined"
              @click="emit('select', null)"
              @dblclick="emit('drill', null)"
            >
              <span class="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[var(--ink-3)] text-white">
                <House :size="10" />
              </span>
              <span class="min-w-0 flex-1 truncate">Global</span>
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
            </button>
          </div>
        </li>
      </ul>

      <!-- The canvas's header strip, label-less: just the new-folder /
           new-workspace affordances riding the right edge. -->
      <div class="flex items-center justify-end gap-1 px-3 pb-0.5 pt-2.5">
        <button
          type="button"
          aria-label="New folder"
          title="New folder"
          class="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 transition hover:bg-row-hover hover:text-ink-1"
          @click="emit('create-group')"
        >
          <FolderPlus :size="13" />
        </button>
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

      <!-- Folders (alive members). Dashed border only while a drag hovers —
           the canvas's drop-target treatment. -->
      <div class="grid gap-1 px-2">
        <div
          v-for="group in props.groups"
          :key="group.id"
          class="rounded-sm border border-dashed p-0.5 transition"
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
            <div class="flex w-full items-center gap-2 rounded-sm px-1.5 text-ink-2">
              <button
                type="button"
                :aria-expanded="!collapsedFolderIds.has(group.id)"
                class="flex h-7 min-w-0 flex-1 cursor-default items-center gap-2 text-left text-xs transition hover:text-ink-1"
                @click="toggleFolder(group.id)"
              >
                <component
                  :is="collapsedFolderIds.has(group.id) ? CaretRight : CaretDown"
                  :size="10"
                  class="shrink-0 text-ink-3"
                />
                <component
                  :is="collapsedFolderIds.has(group.id) ? Folder : FolderOpen"
                  :size="13"
                  class="shrink-0 text-ink-3"
                />
                <input
                  v-if="editingGroupId === group.id"
                  ref="renameInput"
                  v-model="editingName"
                  maxlength="60"
                  :aria-label="`Rename ${group.name}`"
                  class="min-w-0 flex-1 rounded-sm bg-inset px-1 text-xs text-ink-1 outline-none"
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
                <span class="shrink-0 text-2xs text-ink-3">
                  {{ membersByGroupId.get(group.id)?.length ?? 0 }}
                </span>
              </button>
            </div>
          </ContextMenu>
          <ul
            v-if="!collapsedFolderIds.has(group.id)"
            class="grid list-none gap-1 pl-3"
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
        class="mx-2 mt-1 grid list-none gap-[5px] rounded-sm border border-dashed p-0.5 transition"
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
          class="mt-2 flex w-full cursor-default items-center gap-2 px-4 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3 transition hover:text-ink-1"
          data-testid="tree-not-running"
          @click="toggleParked"
        >
          <component :is="isParkedOpen ? CaretDown : CaretRight" :size="10" class="shrink-0" />
          Not running
          <span class="flex-1" />
          <span class="text-2xs normal-case tracking-normal">{{ parkedWorkspaces.length }}</span>
        </button>
        <ul v-if="isParkedOpen" class="grid list-none gap-[5px] px-2">
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
