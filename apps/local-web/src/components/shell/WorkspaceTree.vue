<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  PhCaretDown as CaretDown,
  PhCaretRight as CaretRight,
  PhHouse as House,
  PhPlus as Plus,
  PhStack as Stack,
} from "@phosphor-icons/vue";
import { ContextMenu } from "@vynel/ui";
import type { MenuItemModel } from "@vynel/ui";
import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";
import SidebarAccountRow from "./SidebarAccountRow.vue";
import TreeStateMark from "./TreeStateMark.vue";
import WorkspaceTreeRow from "./WorkspaceTreeRow.vue";
import WorkspaceTreeSectionHeader from "./WorkspaceTreeSectionHeader.vue";
import type { WorkspaceStatusView } from "../../composables/workspaces/use-workspace-status.js";
import {
  activityBucketOfStatus,
  groupActivityBucket,
  type WorkspaceActivityBucket,
} from "./workspace-activity-bucket.js";
import {
  ROOT_LIST_KEY,
  emptyTreeOrder,
  sortByStoredOrder,
  type TreeOrder,
} from "./tree-order.js";
import { useTreeDragDrop } from "./use-tree-drag-drop.js";

// Menu mode's sidebar root — the workspace tree: the pinned Global row, then
// each ACTIVITY SECTION (Active Projects, Not running), and inside a section
// the user's groups (each with its members) followed by the ungrouped
// workspaces.
//
// A row's SECTION is derived from its status, never dragged (Chad,
// 2026-08-24 — reversing Kafi's 2026-08-19 "dims where it sits"): a quiet
// project sits under Not running; the moment it runs, waits on you, or gets
// stuck it is active. Order is still the user's inside a section; the
// section is just the top-level split. A GROUP is never split across
// sections — it moves whole, and counts as active while any one member is
// (splitting a group would put half of "Client work" in each section, which
// reads as two groups with one name).
//
// Groups and workspaces drag: between rows to reorder, onto a group header to
// join it, onto the root zone to leave it; a group drags above/below another
// group. Position comes in as `treeOrder` and goes out as `order-change` (the
// host stores it); membership goes to the host and re-renders from the
// server's answer. A group's context menu renames inline or deletes (members
// detach, never deleted — the engine enforces it). Row click opens that
// workspace's chat; the caret drills. Data-blind: rows + groups + status
// views in, events out.
const props = defineProps<{
  workspaces: {
    id: string;
    name: string;
    groupId: string | null;
    imageUrl?: string | null;
    /** A CSS colour — the workspace's accent (custom hex or palette reference). */
    accent?: string;
    /** Null = still needs setting up (the sidebar's NEEDS SETUP section). */
    setupCompletedAt?: string | null;
  }[];
  groups: { id: string; name: string }[];
  /** The active scope: a workspace id, or null for Global. */
  activeWorkspaceId: string | null;
  /** A group the host just created for the user (from the header's stack-plus):
   *  the tree opens its rename box the moment the row is on screen. */
  renameGroupId?: string | null;
  /** Where the user dragged things — the host's stored layout (null until the first drop). */
  treeOrder?: TreeOrder | null;
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
  /** Make a new group (the host names it); the tree opens its rename box on arrival. */
  "create-group": [];
  "rename-group": [groupId: string, name: string];
  "delete-group": [groupId: string];
  "move-workspace": [workspaceId: string, groupId: string | null];
  /** A drop produced a new arrangement — the host stores it. */
  "order-change": [order: TreeOrder];
  "open-account": [];
}>();

function statusViewOf(workspaceId: string): WorkspaceStatusView | null {
  return props.statusByWorkspaceId[workspaceId] ?? null;
}

// ── Order: the server's lists, sorted by where the user dragged things. ──
const order = computed(() => props.treeOrder ?? emptyTreeOrder());
const orderedGroups = computed(() => sortByStoredOrder(props.groups, order.value.groups));

// A groupId whose group is gone (stale cache mid-refetch) renders at the
// root rather than vanishing.
const knownGroupIds = computed(() => new Set(props.groups.map((group) => group.id)));
function listKeyOfWorkspace(workspace: { groupId: string | null }): string {
  return workspace.groupId !== null && knownGroupIds.value.has(workspace.groupId)
    ? workspace.groupId
    : ROOT_LIST_KEY;
}
const membersByListKey = computed(() => {
  const buckets = new Map<string, typeof props.workspaces>();
  for (const workspace of props.workspaces) {
    const key = listKeyOfWorkspace(workspace);
    const bucket = buckets.get(key) ?? [];
    bucket.push(workspace);
    buckets.set(key, bucket);
  }
  const ordered = new Map<string, typeof props.workspaces>();
  for (const [key, members] of buckets) {
    ordered.set(key, sortByStoredOrder(members, order.value.workspaces[key]));
  }
  return ordered;
});
function membersOf(listKey: string) {
  return membersByListKey.value.get(listKey) ?? [];
}

// ── Sections: the Needs setup / Active / Not running split, read off each
// row's own facts. A project that has not been through "Finish setting up"
// (`setupCompletedAt` null) belongs in NEEDS SETUP — it beats status, because
// a project you have not finished setting up is not "running" in any sense
// that helps you. ──
function bucketOf(workspaceId: string): WorkspaceActivityBucket {
  const workspace = props.workspaces.find((row) => row.id === workspaceId);
  if (workspace !== undefined && (workspace.setupCompletedAt ?? null) === null) {
    return "needs-setup";
  }
  return activityBucketOfStatus(statusViewOf(workspaceId)?.status ?? null);
}

const bucketByGroupId = computed(() => {
  const buckets = new Map<string, WorkspaceActivityBucket>();
  for (const group of props.groups) {
    buckets.set(
      group.id,
      groupActivityBucket(membersOf(group.id).map((workspace) => bucketOf(workspace.id))),
    );
  }
  return buckets;
});

const SECTIONS = [
  // Needs setup FIRST — a section that BLOCKS work belongs above the work.
  // Hidden entirely at zero (the template): it is not a universal state, and a
  // permanent "NEEDS SETUP 0" as the first row is noise.
  { id: "needs-setup", label: "Needs setup", addable: false, accent: false },
  // Active Projects wears the accent and carries the create buttons — the
  // working things are the headline, and nothing is born parked.
  { id: "active", label: "Active Projects", addable: true, accent: true },
  { id: "not-running", label: "Not running", addable: false, accent: false },
] as const;

// Each section's own groups + ungrouped rows, in the user's stored order.
// The count is PROJECTS, not rows on screen — a group contributes its
// members, so "4" means four projects whether or not they sit in groups.
const sections = computed(() =>
  SECTIONS.map((section) => {
    const groups = orderedGroups.value.filter(
      (group) => bucketByGroupId.value.get(group.id) === section.id,
    );
    const rootWorkspaces = membersOf(ROOT_LIST_KEY).filter(
      (workspace) => bucketOf(workspace.id) === section.id,
    );
    const count =
      groups.reduce((total, group) => total + membersOf(group.id).length, 0) +
      rootWorkspaces.length;
    return { ...section, groups, rootWorkspaces, count };
  })
    // Needs setup is not a universal state — drop it entirely at zero rather
    // than leave a permanent "NEEDS SETUP 0" as the first row.
    .filter((section) => section.id !== "needs-setup" || section.count > 0),
);

// ── Drag and drop — the composable owns the state + drop math. ──
// Both display orders are the sections CONCATENATED, so a drop index means
// the same thing it looks like on screen even across a section boundary.
const dnd = useTreeDragDrop({
  order,
  displayedGroupIds: () =>
    sections.value.flatMap((section) => section.groups.map((group) => group.id)),
  displayedListIds: (listKey) =>
    listKey === ROOT_LIST_KEY
      ? sections.value.flatMap((section) =>
          section.rootWorkspaces.map((workspace) => workspace.id),
        )
      : membersOf(listKey).map((workspace) => workspace.id),
  listKeyOfWorkspace: (workspaceId) => {
    const workspace = props.workspaces.find((row) => row.id === workspaceId);
    return workspace === undefined ? ROOT_LIST_KEY : listKeyOfWorkspace(workspace);
  },
  onMoveWorkspace: (workspaceId, groupId) => emit("move-workspace", workspaceId, groupId),
  onOrderChange: (next) => emit("order-change", next),
});

// ── Fold state — group folds and section folds, persisted like the sidebar's
// group folds, each under its own key. ──
function readStoredIds(storageKey: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}
function toggleStoredId(ids: Set<string>, id: string, storageKey: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  localStorage.setItem(storageKey, JSON.stringify([...next]));
  return next;
}

const FOLDS_STORAGE_KEY = "vynel.tree.collapsed-folders";
const collapsedFolderIds = ref<Set<string>>(readStoredIds(FOLDS_STORAGE_KEY));
function toggleFolder(groupId: string) {
  collapsedFolderIds.value = toggleStoredId(collapsedFolderIds.value, groupId, FOLDS_STORAGE_KEY);
}

const SECTION_FOLDS_STORAGE_KEY = "vynel.tree.collapsed-sections";
const collapsedSectionIds = ref<Set<string>>(readStoredIds(SECTION_FOLDS_STORAGE_KEY));
function toggleSection(sectionId: string) {
  collapsedSectionIds.value = toggleStoredId(
    collapsedSectionIds.value,
    sectionId,
    SECTION_FOLDS_STORAGE_KEY,
  );
}

// Which section's root zone the pointer is over. `dnd.isRootTarget()` knows a
// root drop is in flight but not WHERE — without this both sections would
// light up at once.
const hoveredRootSectionId = ref<string | null>(null);

// ── Inline group rename (context menu or double-click → input swap). The
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

// A group the host just made for the user opens straight into its rename box
// so it never sits under a placeholder name — once per id, whenever both the
// id and its row are on screen (the mutation's success and the refetch land
// in either order).
const renamedOnArrivalId = ref<string | null>(null);
watch(
  [() => props.renameGroupId, () => props.groups],
  ([groupId, groups]) => {
    if (!groupId || renamedOnArrivalId.value === groupId) return;
    const arrived = groups.find((group) => group.id === groupId);
    if (arrived === undefined) return;
    renamedOnArrivalId.value = groupId;
    startRename(arrived);
  },
  { immediate: true },
);

function commitRename() {
  const groupId = editingGroupId.value;
  const name = editingName.value.trim();
  editingGroupId.value = null;
  if (groupId !== null && name.length > 0) emit("rename-group", groupId, name);
}

const GROUP_MENU: MenuItemModel[] = [
  { id: "rename", label: "Rename group" },
  { id: "delete", label: "Delete group", danger: true },
];
function onGroupMenu(group: { id: string; name: string }, itemId: string) {
  if (itemId === "rename") startRename(group);
  else if (itemId === "delete") emit("delete-group", group.id);
}
</script>

<template>
  <!-- The canvas's sidebar column: on `--color-bg` (flush with the canvas, a
       hairline apart), the container itself padded `16.8px 8.4px` so every
       child — the account foot included — sits inset. -->
  <nav class="flex h-full flex-col bg-[var(--color-bg)] px-[8.4px] py-[16.8px] text-[12.5px]">
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ul class="my-0 grid list-none gap-1 pl-0">
        <!-- The pinned Global scope — the tree's anchor. It carries only its
             own status; creating lives on the Active Projects header and on
             each group. -->
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
              <!-- The same state mark every workspace row ends with — parked
                   play glyph included (Kafi, 2026-08-26). -->
              <span class="flex items-center gap-[7px]">
                <TreeStateMark :status="props.globalStatus" name="Global" />
              </span>
            </button>
          </div>
        </li>
      </ul>

      <!-- Each activity section: its heading + count, then its groups, then
           its ungrouped rows. Sections always render, empty or not — a
           "NOT RUNNING 0" tells you nothing is parked, which is worth
           knowing; a heading that vanishes just reads as a bug. -->
      <section v-for="section in sections" :key="section.id" class="tree-section mt-2">
        <WorkspaceTreeSectionHeader
          :label="section.label"
          :count="section.count"
          :accent="section.accent"
          :addable="section.addable"
          :collapsed="collapsedSectionIds.has(section.id)"
          @toggle="toggleSection(section.id)"
          @create-group="emit('create-group')"
          @create-workspace="emit('create-workspace', null)"
        />

        <template v-if="!collapsedSectionIds.has(section.id)">
          <!-- Groups. Dashed border while a workspace hovers the header (join);
               an insertion line above/below while another group hovers (reorder). -->
          <div class="mt-1.5 grid gap-2">
            <div
              v-for="group in section.groups"
              :key="group.id"
              class="tree-group rounded-sm border border-dashed pb-1.5 transition"
              :class="[
                dnd.isGroupHeaderTarget(group.id) ? 'border-gold bg-gold-soft' : 'border-transparent',
                dnd.groupSlotEdge(group.id) === 'before' && 'tree-drop-before',
                dnd.groupSlotEdge(group.id) === 'after' && 'tree-drop-after',
              ]"
              @drop.prevent="dnd.drop()"
            >
              <ContextMenu :items="GROUP_MENU" @select="(id) => onGroupMenu(group, id)">
                <div
                  class="tree-group-header mb-1 flex w-full items-center pl-[7px] pr-[5px] text-ink-1"
                  draggable="true"
                  @dragstart="dnd.startGroupDrag(group.id)"
                  @dragend="dnd.endDrag()"
                  @dragover="dnd.onGroupHeaderDragOver($event, group.id)"
                  @dragleave="dnd.clearTargetIf((t) => 'groupId' in t && t.groupId === group.id)"
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
                    <!-- A GROUP of workspaces — the stack glyph, never a folder
                         (folders mean files everywhere else now). -->
                    <Stack :size="13" weight="duotone" class="shrink-0 text-[var(--color-neutral-400)]" />
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
                      {{ membersOf(group.id).length }}
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
              <!-- Members hang off a guide line dropped from the header's own
                   left edge, so an ungrouped row below (flush left, no spine)
                   never reads as one of them. The 7px + 1px rule + 4px pad keeps
                   each row at the same 12px indent the tree has always used. -->
              <ul
                v-if="!collapsedFolderIds.has(group.id)"
                class="tree-members my-0 ml-[7px] grid list-none gap-0.5 border-l border-hair-strong pl-1"
              >
                <li
                  v-for="workspace in membersOf(group.id)"
                  :key="workspace.id"
                  class="tree-slot rounded-sm"
                  :class="[
                    dnd.rowEdge(workspace.id) === 'before' && 'tree-drop-before',
                    dnd.rowEdge(workspace.id) === 'after' && 'tree-drop-after',
                  ]"
                  @dragover="dnd.onRowDragOver($event, workspace.id, group.id)"
                  @dragleave="dnd.clearTargetIf((t) => t.kind === 'row' && t.workspaceId === workspace.id)"
                  @drop.prevent.stop="dnd.drop()"
                >
                  <WorkspaceTreeRow
                    :workspace="workspace"
                    :is-active="props.activeWorkspaceId === workspace.id"
                    :status-view="statusViewOf(workspace.id)"
                    @select="emit('select', workspace.id)"
                    @drill="emit('drill', workspace.id)"
                    @drag-start="dnd.startWorkspaceDrag(workspace.id)"
                    @drag-end="dnd.endDrag()"
                  />
                </li>
              </ul>
            </div>
          </div>

          <!-- The root zone — ungrouped rows, in their own order; a drop on the
               zone itself detaches (last), a drop between rows places. -->
          <ul
            class="tree-root mt-2 mb-0 grid min-h-6 list-none gap-0.5 rounded-sm border border-dashed p-0.5 pl-0.5 transition"
            :class="
              dnd.isRootTarget() && hoveredRootSectionId === section.id
                ? 'border-gold bg-gold-soft'
                : 'border-transparent'
            "
            @dragover="hoveredRootSectionId = section.id, dnd.onRootDragOver($event)"
            @dragleave="
              hoveredRootSectionId = null, dnd.clearTargetIf((t) => t.kind === 'root')
            "
            @drop.prevent="hoveredRootSectionId = null, dnd.drop()"
          >
            <li
              v-for="workspace in section.rootWorkspaces"
              :key="workspace.id"
              class="tree-slot rounded-sm"
              :class="[
                dnd.rowEdge(workspace.id) === 'before' && 'tree-drop-before',
                dnd.rowEdge(workspace.id) === 'after' && 'tree-drop-after',
              ]"
              @dragover="dnd.onRowDragOver($event, workspace.id, ROOT_LIST_KEY)"
              @dragleave="dnd.clearTargetIf((t) => t.kind === 'row' && t.workspaceId === workspace.id)"
              @drop.prevent.stop="dnd.drop()"
            >
              <WorkspaceTreeRow
                :workspace="workspace"
                :is-active="props.activeWorkspaceId === workspace.id"
                :status-view="statusViewOf(workspace.id)"
                @select="emit('select', workspace.id)"
                @drill="emit('drill', workspace.id)"
                @drag-start="dnd.startWorkspaceDrag(workspace.id)"
                @drag-end="dnd.endDrag()"
              />
            </li>
          </ul>
        </template>
      </section>

      <p
        v-if="props.workspaces.length === 0"
        class="px-[10px] py-2 text-[12px] text-[var(--color-neutral-600)]"
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

/* The insertion line — where the dragged row/group will land. Painted as an
   inset shadow so it never shifts layout. */
.tree-drop-before {
  box-shadow: inset 0 2px 0 0 var(--gold);
}

.tree-drop-after {
  box-shadow: inset 0 -2px 0 0 var(--gold);
}
</style>
