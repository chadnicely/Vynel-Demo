<script setup lang="ts">
import { computed } from "vue";
import { PhCaretRight as CaretRight } from "@phosphor-icons/vue";
import { workspaceColorSlot, workspaceMonogram } from "@vynel/ui";
import type { WorkspaceStatusView } from "../../composables/workspaces/use-workspace-status.js";
import TreeStateMark from "./TreeStateMark.vue";

// One workspace row of the tree: caret · the workspace's OWN icon (its
// uploaded image, else its monogram over its accent — the same face its
// chips wear in chat) · name · the state cluster on the RIGHT: `done/total`,
// then ONE mark, ALWAYS (TreeStateMark — the Global row wears the same one).
// Kafi, 2026-08-19: state moved right, icon took the left, marks bolder;
// every row ends with its state, open tasks or not. Used at
// the root, inside groups, and under NOT RUNNING, so the row lives in
// exactly one home. Draggable: the tree owns the drag-and-drop state; the
// row only reports its lifecycle. Data-blind — the icon fields ride in on
// the workspace option; a bare {id, name} still paints a monogram.
const props = defineProps<{
  workspace: {
    id: string;
    name: string;
    /** The customized workspace image (data URL), if one was uploaded. */
    imageUrl?: string | null;
    /** A CSS colour — the customized accent (hex or palette slot), else the name's own. */
    accent?: string;
  };
  isActive: boolean;
  statusView: WorkspaceStatusView | null;
}>();

const emit = defineEmits<{
  select: [];
  drill: [];
  "drag-start": [];
  "drag-end": [];
}>();

const monogram = computed(() => workspaceMonogram(props.workspace.name));
const accent = computed(
  () => props.workspace.accent ?? `var(--ws-${workspaceColorSlot(props.workspace.name)})`,
);

function status() {
  return props.statusView?.status ?? "not_running";
}

// The count reads quieter beside a bold mark (dot) than beside the spinner
// or the play glyph.
function hasMarkDot(): boolean {
  const current = status();
  return current === "needs_input" || current === "problem" || current === "completed";
}

function progressLabel(): string | null {
  const view = props.statusView;
  if (view === null || view.tasksTotal === 0) return null;
  // A parked room (quiet, everything done) shows no numbers — the canvas's
  // bare NOT RUNNING rows; a quiet room with OPEN work keeps its `3/10`.
  if (status() === "not_running" && view.tasksDone >= view.tasksTotal) return null;
  return `${view.tasksDone}/${view.tasksTotal}`;
}
</script>

<template>
  <div
    class="group flex items-center rounded-sm pl-[10px] pr-[9px] transition"
    :class="[
      props.isActive
        ? 'bg-[var(--color-accent-900)] text-[var(--color-accent-100)]'
        : 'text-ink-2 hover:bg-row-hover hover:text-ink-1',
    ]"
    draggable="true"
    @dragstart="emit('drag-start')"
    @dragend="emit('drag-end')"
  >
    <button
      type="button"
      :aria-label="`Open the ${props.workspace.name} menu`"
      class="tree-caret grid w-3 shrink-0 self-stretch place-items-center rounded-sm text-[var(--color-neutral-600)] transition hover:text-ink-1"
      @click="emit('drill')"
    >
      <CaretRight :size="10" />
    </button>
    <button
      type="button"
      class="ml-2 grid min-h-[30px] min-w-0 flex-1 cursor-default grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 py-1 text-left text-[12.5px]"
      :class="{ 'opacity-50': status() === 'not_running' && !props.isActive }"
      :aria-current="props.isActive ? 'page' : undefined"
      @click="emit('select')"
      @dblclick="emit('drill')"
    >
      <!-- The workspace's own face — an uploaded logo as-is (no tint behind
           it), else its monogram over its accent. -->
      <span
        class="tree-icon grid size-[18px] shrink-0 place-items-center overflow-hidden rounded-[5px] text-[8px] font-bold leading-none"
        :style="
          props.workspace.imageUrl
            ? undefined
            : {
                background: `color-mix(in srgb, ${accent} 30%, transparent)`,
                color: accent,
              }
        "
        aria-hidden="true"
      >
        <img
          v-if="props.workspace.imageUrl"
          :src="props.workspace.imageUrl"
          alt=""
          class="size-full object-contain"
        />
        <span v-else>{{ monogram }}</span>
      </span>
      <span class="min-w-0 truncate">{{ props.workspace.name }}</span>
      <!-- The state cluster, on the right: progress, then one mark. -->
      <span class="flex items-center gap-[7px]">
        <span
          v-if="progressLabel()"
          class="whitespace-nowrap text-[10.5px] font-medium tabular-nums"
          :class="
            hasMarkDot()
              ? 'text-[var(--color-neutral-400)]'
              : 'text-[var(--color-neutral-500)]'
          "
        >
          {{ progressLabel() }}
        </span>
        <TreeStateMark :status="status()" :name="props.workspace.name" />
      </span>
    </button>
  </div>
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
