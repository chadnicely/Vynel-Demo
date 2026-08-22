<script setup lang="ts">
import { PhArrowRight, PhFolderOpen, PhListChecks } from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";

// The fork that opens before any workspace is added, ported from Chad's
// design branch (start.html → AddProjectDialog). Two answers, and they are
// genuinely different journeys: something new gets planned and built for
// you; something you already have gets looked after where it already sits —
// nothing moves. THE CARDS ARE THE SCREEN (Chad, 2026-08-10): two tall doors,
// not two small boxes in a void.
//
// Only doors that exist are offered — no dead buttons (Chad's rule). "Create
// from a repository" joins when the clone slice lands; "Set it up instantly"
// when Quick Create does.
defineProps<{ open: boolean }>();

const emit = defineEmits<{
  close: [];
  pick: [choice: "wizard" | "folder"];
}>();

const DOORS = [
  {
    pick: "wizard" as const,
    icon: PhListChecks,
    group: "Start something new",
    title: "Walk me through it",
    kicker: "12 screens · ten minutes well spent",
    note: "Tell Vynel the idea. It asks a few questions, plans the whole thing, and builds it in steps you approve.",
  },
  {
    pick: "folder" as const,
    icon: PhFolderOpen,
    group: "Bring in what you have",
    title: "Pull from a folder",
    kicker: "A project already on this computer",
    note: "Point at a folder anywhere on this computer. It stays exactly where it is — nothing gets moved.",
  },
];

function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="open"
    title="What are we adding?"
    description="Nothing you already have is ever moved."
    size="lg"
    @update:open="onOpenChange"
  >
    <div class="grid gap-3 py-2 sm:grid-cols-2">
      <button
        v-for="door in DOORS"
        :key="door.pick"
        type="button"
        class="door group grid cursor-default content-start gap-2 rounded-md border border-hair-strong bg-panel p-4 text-left transition hover:border-gold hover:bg-row-hover"
        :data-pick="door.pick"
        @click="emit('pick', door.pick)"
      >
        <span
          class="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3"
        >
          {{ door.group }}
        </span>
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
      <span class="flex-1 text-[12px] text-ink-3">Pick one to carry on</span>
    </template>
  </Modal>
</template>
