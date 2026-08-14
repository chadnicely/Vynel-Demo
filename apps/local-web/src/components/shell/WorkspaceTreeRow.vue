<script setup lang="ts">
import {
  PhCaretRight as CaretRight,
  PhCircleNotch as CircleNotch,
  PhCube as Cube,
  PhMoon as Moon,
  PhPlay as Play,
} from "@phosphor-icons/vue";
import type { WorkspaceStatusView } from "../../composables/workspaces/use-workspace-status.js";

// One workspace row of the tree — the canvas's chrome: caret · 16px STATE
// chip (spinner = running, cube = a state is set, moon = not running) · name
// · `done/total` task progress · the status mark dot (one status one colour).
// Used at the root, inside folders, and in the NOT RUNNING group, so the row
// lives in exactly one home. Draggable: the tree owns the drag-and-drop
// state; the row only reports its lifecycle.
const props = defineProps<{
  workspace: { id: string; name: string };
  isActive: boolean;
  statusView: WorkspaceStatusView | null;
  /** A folder member — the canvas indents the CONTENT (pad-left 24px) and
   *  keeps the row box full-width, so the active ground still spans the
   *  folder. Root rows sit at 10px. */
  indented?: boolean;
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
  <!-- Canvas geometry: pad `6px 11.2px 6px 10px`, a 12px caret column, a 16px
       chip, then name + the meta cluster — so the name lands at x=64 from the
       row's left edge, exactly as the canvas measures. -->
  <div
    class="group flex items-center rounded-sm pr-[11.2px] transition"
    :class="[
      props.indented ? 'pl-[24px]' : 'pl-[10px]',
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
      class="grid w-3 shrink-0 self-stretch place-items-center rounded-sm text-[var(--color-neutral-600)] transition hover:text-ink-1"
      @click="emit('drill')"
    >
      <CaretRight :size="10" />
    </button>
    <button
      type="button"
      class="ml-2 grid min-w-0 flex-1 cursor-default grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-left text-[12.5px]"
      :class="[
        props.indented ? 'min-h-[30px]' : 'min-h-8',
        { 'opacity-50': status() === 'not_running' && !props.isActive },
      ]"
      :aria-current="props.isActive ? 'page' : undefined"
      @click="emit('select')"
      @dblclick="emit('drill')"
    >
      <!-- The state chip: spinner while building, cube when a state is set,
           moon when quiet — the canvas's vocabulary. -->
      <span
        class="grid size-4 shrink-0 place-items-center rounded-[4px]"
        :class="
          status() === 'not_running'
            ? 'bg-[var(--color-neutral-900)] text-[var(--color-neutral-600)]'
            : 'bg-[var(--color-accent-900)] text-[var(--color-accent-200)]'
        "
      >
        <CircleNotch
          v-if="status() === 'running'"
          :size="10"
          class="animate-spin"
        />
        <Moon v-else-if="status() === 'not_running'" :size="10" />
        <Cube v-else :size="10" class="text-[var(--color-neutral-500)]" />
      </span>
      <span class="min-w-0 truncate">{{ props.workspace.name }}</span>
      <!-- The canvas's meta cluster: one `auto` column, 7px apart. -->
      <span class="flex items-center gap-[7px]">
        <span
          v-if="progressLabel()"
          class="whitespace-nowrap text-[10.5px] tabular-nums"
          :class="
            markStatus()
              ? 'text-[var(--color-neutral-500)]'
              : 'text-[var(--color-neutral-600)]'
          "
        >
          {{ progressLabel() }}
        </span>
        <span
          v-if="markStatus()"
          :aria-label="`${props.workspace.name} ${MARK_LABELS[markStatus()!]}`"
          class="tree-mark size-2 shrink-0 rounded-full"
          :data-status="markStatus()"
        />
        <!-- The canvas's parked-row affordance: pick it up where it left off. -->
        <Play
          v-if="status() === 'not_running' && !progressLabel()"
          :size="11"
          class="shrink-0 text-[var(--color-neutral-600)]"
          aria-hidden="true"
          title="Pick up where it left off"
        />
      </span>
    </button>
  </div>
</template>

<style scoped>
/* One status, one colour — the mark dot's hue is the state's, everywhere. */
.tree-mark {
  animation: tree-mark-pulse 1.4s ease-in-out infinite;
}

.tree-mark[data-status="needs_input"] {
  background: var(--needs-input);
}

.tree-mark[data-status="problem"] {
  background: var(--danger);
}

.tree-mark[data-status="completed"] {
  background: var(--ok);
}

@keyframes tree-mark-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.72);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tree-mark {
    animation: none;
  }
}
</style>
