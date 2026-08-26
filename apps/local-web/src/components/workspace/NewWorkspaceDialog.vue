<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PhArrowLeft,
  PhArrowRight,
  PhFolderOpen,
  PhGitBranch,
  PhSparkle,
} from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";

// The fork that opens before any project is added — Chad's staged version
// (2026-08-24), over the flat three-card list.
//
// TWO SHORT QUESTIONS, not one long one: are you starting something new, or
// bringing in what you already have? Only if it is the second does it ask
// WHERE it is — a folder on this computer, or a repository to clone. Someone
// starting fresh is never shown the two answers that are not about them.
//
// Only doors that exist are offered — no dead buttons (Chad's rule). His
// branch forks "something new" again into quick-create vs the wizard; Quick
// Create does not exist here, so new goes straight to the wizard and that
// second fork joins when it ships.
const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  close: [];
  pick: [choice: "wizard" | "folder" | "clone"];
}>();

type Stage = "top" | "existing";
const stage = ref<Stage>("top");

// A re-opened dialog always starts at the top question — reopening into the
// second fork would answer a question the user never got asked.
watch(
  () => props.open,
  (open) => {
    if (open) stage.value = "top";
  },
);

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}

const title = computed(() =>
  stage.value === "existing" ? "Where is it now?" : "What are we adding?",
);

// One line, no lecture — the cards say the rest (Chad, 2026-08-10).
const description = computed(() =>
  stage.value === "existing"
    ? "Nothing you already have is moved — a repository is cloned into a fresh folder."
    : "Nothing you already have is ever moved.",
);

type Door = {
  pick: "wizard" | "folder" | "clone" | "stage:existing";
  icon: typeof PhSparkle;
  title: string;
  kicker: string;
  note: string;
};

const TOP_DOORS: Door[] = [
  {
    pick: "wizard",
    icon: PhSparkle,
    title: "Start something new",
    kicker: "An idea becomes an app",
    note: "Tell Vynel the idea. It asks a few questions, plans the whole thing, and builds it in steps you approve.",
  },
  {
    pick: "stage:existing",
    icon: PhFolderOpen,
    title: "Bring in what you have",
    kicker: "A project you already have",
    note: "Vynel looks after it where it already sits. Nothing is moved.",
  },
];

const EXISTING_DOORS: Door[] = [
  {
    pick: "folder",
    icon: PhFolderOpen,
    title: "Pull from a folder",
    kicker: "A project already on this computer",
    note: "Point at a folder anywhere on this computer. It stays exactly where it is — nothing gets moved.",
  },
  {
    pick: "clone",
    icon: PhGitBranch,
    title: "Create local from a repository",
    kicker: "Clone from a git address",
    note: "Paste the address of a repository you already have. It is cloned into a new folder.",
  },
];

const doors = computed(() =>
  stage.value === "existing" ? EXISTING_DOORS : TOP_DOORS,
);

function choose(pick: Door["pick"]) {
  if (pick === "stage:existing") {
    stage.value = "existing";
    return;
  }
  emit("pick", pick);
}
</script>

<template>
  <Modal
    :open="open"
    :title="title"
    :description="description"
    size="xl"
    @update:open="onOpenChange"
  >
    <div class="grid gap-3 py-2 sm:grid-cols-2">
      <button
        v-for="door in doors"
        :key="door.pick"
        type="button"
        class="door group grid cursor-default content-start gap-2 rounded-md border border-hair-strong bg-panel p-4 text-left transition hover:border-gold hover:bg-row-hover"
        :data-pick="door.pick"
        @click="choose(door.pick)"
      >
        <span
          class="grid size-10 place-items-center rounded-md bg-gold-soft text-gold"
        >
          <component :is="door.icon" :size="22" />
        </span>
        <span class="text-[14px] text-ink-1">{{ door.title }}</span>
        <span class="text-[11.5px] text-ink-3">{{ door.kicker }}</span>
        <span class="text-[12px] leading-relaxed text-ink-2">{{
          door.note
        }}</span>
        <span
          class="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-gold opacity-0 transition group-hover:opacity-100"
        >
          Choose <PhArrowRight :size="13" />
        </span>
      </button>
    </div>

    <template #footer>
      <button
        v-if="stage === 'existing'"
        type="button"
        class="back inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-2 transition hover:text-ink-1"
        @click="stage = 'top'"
      >
        <PhArrowLeft :size="13" /> Back
      </button>
      <span class="flex-1 text-[12px] text-ink-3">Pick one to carry on</span>
    </template>
  </Modal>
</template>
