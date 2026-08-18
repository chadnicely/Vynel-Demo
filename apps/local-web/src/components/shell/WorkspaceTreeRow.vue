<script setup lang="ts">
import { computed } from "vue";
import {
  PhCaretRight as CaretRight,
  PhCircleNotch as CircleNotch,
  PhPlay as Play,
} from "@phosphor-icons/vue";
import { workspaceColorSlot, workspaceMonogram } from "@vynel/ui";
import type { WorkspaceStatusView } from "../../composables/workspaces/use-workspace-status.js";

// One workspace row of the tree: caret · the workspace's OWN icon (its
// uploaded image, else its monogram over its accent — the same face its
// chips wear in chat) · name · the state cluster on the RIGHT: `done/total`,
// then ONE mark — spinner while working, a bold status dot when it needs
// you / hit a problem / completed, the play glyph when parked (Kafi,
// 2026-08-19: state moved right, icon took the left, marks bolder). Used at
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

const MARK_LABELS = {
  needs_input: "is waiting on you",
  problem: "hit a problem",
  completed: "is completed",
} as const;

const monogram = computed(() => workspaceMonogram(props.workspace.name));
const accent = computed(
  () => props.workspace.accent ?? `var(--ws-${workspaceColorSlot(props.workspace.name)})`,
);

function status() {
  return props.statusView?.status ?? "not_running";
}

function markStatus(): keyof typeof MARK_LABELS | null {
  const current = status();
  return current === "needs_input" || current === "problem" || current === "completed"
    ? current
    : null;
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
            markStatus()
              ? 'text-[var(--color-neutral-400)]'
              : 'text-[var(--color-neutral-500)]'
          "
        >
          {{ progressLabel() }}
        </span>
        <CircleNotch
          v-if="status() === 'running'"
          :size="14"
          weight="bold"
          class="tree-state-running shrink-0 animate-spin text-gold"
          aria-label="Working"
        />
        <span
          v-else-if="markStatus()"
          :aria-label="`${props.workspace.name} ${MARK_LABELS[markStatus()!]}`"
          class="tree-mark size-2.5 shrink-0 rounded-full"
          :data-status="markStatus()"
        />
        <!-- The parked-row affordance: pick it up where it left off. -->
        <Play
          v-else-if="status() === 'not_running' && !progressLabel()"
          :size="12"
          weight="fill"
          class="tree-state-parked shrink-0 text-[var(--color-neutral-500)]"
          aria-hidden="true"
          title="Pick up where it left off"
        />
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

/* One status, one colour — the mark dot's hue is the state's, everywhere.
   A soft ring of the same hue makes it read from across the room. */
.tree-mark {
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent);
  animation: tree-mark-pulse 1.4s ease-in-out infinite;
}

.tree-mark[data-status="needs_input"] {
  background: var(--needs-input);
  color: var(--needs-input);
}

.tree-mark[data-status="problem"] {
  background: var(--danger);
  color: var(--danger);
}

.tree-mark[data-status="completed"] {
  background: var(--ok);
  color: var(--ok);
}

@keyframes tree-mark-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.8);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tree-mark {
    animation: none;
  }
}
</style>
