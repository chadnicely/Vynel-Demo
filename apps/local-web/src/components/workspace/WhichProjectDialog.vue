<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PhFolderOpen, PhWarning } from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import { useRegisterWorkspace } from "../../composables/workspaces/use-register-workspace.js";
import { usePickProjectFolder } from "../../composables/workspaces/use-pick-project-folder.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// "Which project?" — a project the user already has (Chad, 2026-08-24).
//
// One button opens the operating system's own folder window — the one people
// know from every other program — and Vynel looks inside whatever they
// picked:
//
//   it IS a project      -> add it
//   it HOLDS projects    -> tick which ones, add several at once
//   nothing recognisable -> say so, and offer to add it anyway
//
// Nothing is ever moved. The folder stays exactly where it is; only its path
// is recorded. (The in-app folder tree, `CreateWorkspaceDialog`, stays in the
// tree — how it attaches to this screen is a later decision, Kafi 2026-08-27.)
const props = defineProps<{
  open: boolean;
  /** The menu-tree group this was opened from; null = the tree root. */
  groupId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  /** EVERY project that landed, not just the first — the shell decides what
   *  to open off how many there are. */
  created: [workspaces: WorkspaceResponse[]];
}>();

const picker = usePickProjectFolder();
const register = useRegisterWorkspace();

/** Which of the found projects are ticked — all of them, until told otherwise. */
const ticked = ref<Set<string>>(new Set());
const addError = ref<string | null>(null);
/** Projects that failed while the rest went in — named, never swallowed. */
const failures = ref<{ name: string; reason: string }[]>([]);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    picker.reset();
    ticked.value = new Set();
    addError.value = null;
    failures.value = [];
  },
);

// A fresh scan ticks everything it found — the common case is "yes, all of
// those", and unticking two is less work than ticking eight.
watch(
  () => picker.scan.value,
  (scan) => {
    failures.value = [];
    addError.value = null;
    ticked.value =
      scan?.kind === "several"
        ? new Set(scan.projects.map((project) => project.path))
        : new Set();
  },
);

function toggle(path: string) {
  const next = new Set(ticked.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  ticked.value = next;
}

function basename(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? fullPath;
}

const chosen = computed(() => {
  const scan = picker.scan.value;
  if (scan?.kind === "single") return [scan.project];
  if (scan?.kind === "several") {
    return scan.projects.filter((project) => ticked.value.has(project.path));
  }
  // Nothing recognised: "add it anyway" adopts the folder itself.
  return picker.pickedPath.value === null
    ? []
    : [
        {
          path: picker.pickedPath.value,
          name: basename(picker.pickedPath.value),
          foundBy: "you",
        },
      ];
});

const addLabel = computed(() => {
  const count = chosen.value.length;
  if (count > 1) return `Add ${count} projects`;
  return "Add it";
});

const gate = computed(() => {
  if (picker.pickedPath.value === null) return "Pick a folder to carry on";
  if (picker.scan.value?.kind === "several" && chosen.value.length === 0) {
    return "Tick at least one to carry on";
  }
  return null;
});

// One failure never loses the rest (Chad, 2026-08-24): add what worked, name
// what didn't. Losing three good projects because the fourth is already in
// Vynel is the more annoying outcome by far.
async function add() {
  addError.value = null;
  failures.value = [];
  const projects = chosen.value;
  if (projects.length === 0) return;

  const added: WorkspaceResponse[] = [];
  for (const project of projects) {
    try {
      const workspace = await register.mutateAsync({
        name: project.name,
        directory: project.path,
        ...(props.groupId !== null ? { groupId: props.groupId } : {}),
      });
      added.push(workspace as WorkspaceResponse);
    } catch (error) {
      failures.value.push({ name: project.name, reason: formatSdkError(error) });
    }
  }

  if (added.length === 0) {
    addError.value = "Nothing could be added.";
    return;
  }
  emit("created", added);
}

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}

// The screen ASKS until it knows, then CONFIRMS. Leaving the instruction up
// after the folder is chosen tells the user to do the thing they just did —
// which is what made this read as an error rather than an answer (Chad,
// 2026-08-24).
const heading = computed(() => {
  const scan = picker.scan.value;
  if (scan?.kind === "single") return "Found it";
  if (scan?.kind === "several") return "Which of these?";
  if (scan?.kind === "none") return "Nothing recognised in there";
  return "Which project?";
});

const subheading = computed(() => {
  const scan = picker.scan.value;
  if (scan?.kind === "single") {
    return "Vynel will look after it right where it is — nothing moves.";
  }
  if (scan?.kind === "several") {
    return "Tick the ones you want. They all stay exactly where they are.";
  }
  if (scan?.kind === "none") return "";
  return "Pick the folder your projects live in — or one project folder.";
});
</script>

<template>
  <!-- persistent: the OS folder window takes focus off the page, and a plain
       modal reads that as a click outside and dismisses itself — the dialog
       vanished the moment you chose a folder (Chad, 2026-08-24). The X and
       Cancel still close it. -->
  <Modal
    :open="open"
    :title="heading"
    :description="subheading"
    size="lg"
    persistent
    @update:open="onOpenChange"
  >
    <div class="grid gap-4 py-2">
      <!-- Nothing chosen yet: the ONE button is the whole screen. -->
      <div v-if="picker.pickedPath.value === null" class="flex items-center gap-3">
        <button
          type="button"
          class="choose inline-flex items-center gap-2 rounded-md border border-hair-strong bg-panel px-4 py-2.5 text-[13px] text-ink-1 transition hover:border-gold hover:text-gold"
          :disabled="picker.isBusy.value"
          @click="picker.choose()"
        >
          <PhFolderOpen :size="16" />
          Choose folder…
        </button>
        <span v-if="picker.isBusy.value" class="text-[12px] text-ink-3">
          Waiting for the folder window…
        </span>
      </div>

      <p v-if="picker.errorMessage.value" class="m-0 text-[12px] text-danger">
        {{ picker.errorMessage.value }}
      </p>

      <!-- It IS a project — the answer is the hero, not a footnote. -->
      <div
        v-if="picker.scan.value?.kind === 'single'"
        class="found-one grid gap-1 rounded-md border border-gold bg-panel p-4"
      >
        <span class="text-[15px] text-ink-1">{{
          picker.scan.value.project.name
        }}</span>
        <span class="truncate text-[11.5px] text-ink-3">{{
          picker.pickedPath.value
        }}</span>
      </div>

      <!-- It HOLDS projects: tick which ones. -->
      <ul
        v-else-if="picker.scan.value?.kind === 'several'"
        class="found m-0 grid list-none gap-1 p-0"
      >
        <li v-for="project in picker.scan.value.projects" :key="project.path">
          <label class="flex cursor-default items-center gap-2.5 rounded-md p-2 hover:bg-row-hover">
            <input
              type="checkbox"
              :checked="ticked.has(project.path)"
              @change="toggle(project.path)"
            />
            <span class="flex-1 text-[12.5px] text-ink-1">{{ project.name }}</span>
            <span class="text-[11px] text-ink-3">{{ project.foundBy }}</span>
          </label>
        </li>
      </ul>

      <!-- Nothing recognised — his prototype's wording, kept. -->
      <p
        v-else-if="picker.scan.value?.kind === 'none'"
        class="m-0 flex items-start gap-2 text-[12.5px] text-ink-2"
      >
        <PhWarning :size="15" class="mt-0.5 shrink-0 text-needs-input" />
        We could not find anything we recognise in there — no package.json, no
        git. Add it anyway if you know it is a project.
      </p>

      <div v-if="failures.length > 0" class="grid gap-1">
        <p
          v-for="failure in failures"
          :key="failure.name"
          class="m-0 text-[12px] text-needs-input"
        >
          {{ failure.name }} was not added: {{ failure.reason }}
        </p>
      </div>

      <p v-if="addError" class="m-0 text-[12px] text-danger">{{ addError }}</p>
    </div>

    <template #footer>
      <!-- Quiet, and only once there is something to change — as the primary
           button it read like "you picked the wrong one". -->
      <button
        v-if="picker.pickedPath.value !== null"
        type="button"
        class="repick text-[12px] text-ink-3 underline-offset-2 transition hover:text-ink-1 hover:underline"
        :disabled="picker.isBusy.value"
        @click="picker.choose()"
      >
        Pick a different folder
      </button>
      <span class="flex-1 text-[12px] text-ink-3">{{ gate }}</span>
      <button
        type="button"
        class="cancel rounded-md px-3 py-2 text-[12.5px] text-ink-2 transition hover:text-ink-1"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="add rounded-md bg-gold px-4 py-2 text-[12.5px] font-semibold text-shell transition disabled:opacity-55"
        :disabled="gate !== null || register.isPending.value"
        @click="add()"
      >
        {{ register.isPending.value ? "Adding…" : addLabel }}
      </button>
    </template>
  </Modal>
</template>
