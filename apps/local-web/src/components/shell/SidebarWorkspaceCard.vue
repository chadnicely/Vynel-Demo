<script setup lang="ts">
// The drilled workspace's header tile (the canvas's app card): identity chip
// + name + the live status line, on the accent ground. ONE home — the room's
// menus wear it, and so does the room's sessions column (Kafi, 2026-08-24:
// "keep the workspace tile"), so the two can never drift apart.
export interface SidebarWorkspaceCardModel {
  name: string;
  /** The workspace's uploaded logo (data URL) — the same face the tree
   *  shows; null = the monogram. */
  imageUrl: string | null;
  initials: string;
  statusLine: string;
  /** The status vocabulary key — colours the meta line (one status one
   *  colour). */
  statusTone: "running" | "needs_input" | "problem" | "completed" | "not_running";
}

const props = defineProps<{
  card: SidebarWorkspaceCardModel;
}>();
</script>

<template>
  <div
    class="mb-[8.4px] mt-0.5 flex items-center gap-[9px] rounded-sm bg-[var(--color-accent-900)] px-[11.2px] py-[7px]"
    data-testid="sidebar-workspace-card"
  >
    <!-- The logo as-is (no tint behind it, like the tree row), else the
         monogram on the accent. -->
    <span
      class="workspace-card-face grid size-5 shrink-0 place-items-center overflow-hidden rounded-[4px] text-[9px] text-[var(--color-accent-100)]"
      :class="{ 'bg-[var(--color-accent-600)]': !props.card.imageUrl }"
    >
      <img
        v-if="props.card.imageUrl"
        :src="props.card.imageUrl"
        alt=""
        class="size-full object-contain"
      />
      <template v-else>{{ props.card.initials }}</template>
    </span>
    <span class="flex min-w-0 flex-col gap-px">
      <span class="truncate text-[13px] leading-tight text-[var(--color-accent-100)]">
        {{ props.card.name }}
      </span>
      <span
        class="workspace-card-meta truncate text-[10.5px] leading-snug"
        :data-status="props.card.statusTone"
      >
        {{ props.card.statusLine }}
      </span>
    </span>
  </div>
</template>

<style scoped>
/* One status, one colour — the header card's meta line. */
.workspace-card-meta {
  color: var(--color-accent-300);
}

.workspace-card-meta[data-status="needs_input"] {
  color: var(--needs-input);
}

.workspace-card-meta[data-status="problem"] {
  color: var(--danger);
}

.workspace-card-meta[data-status="completed"] {
  color: var(--ok);
}
</style>
