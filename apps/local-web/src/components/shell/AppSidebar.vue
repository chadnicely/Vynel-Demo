<script setup lang="ts">
import { computed, ref, watch, type Component } from "vue";
import { PhArrowLeft as ArrowLeft, PhCaretRight as ChevronRight } from "@phosphor-icons/vue";
import SidebarAccountRow from "./SidebarAccountRow.vue";

export interface SidebarItem {
  id: string;
  label: string;
  icon?: Component;
  // Consecutive items sharing a group id render under one expandable
  // header; ungrouped items are plain rows (Home / Chat / Sessions,
  // Marketplace, the system rows).
  group?: { id: string; label: string };
}

// The left navigation: plain rows at the top, then the feature sections
// under expandable group headers (Chad, 2026-08-04 — supersedes the earlier
// one-plain-list call). Data-blind — the shell owns routing + state; the
// only state here is which groups are folded, which is presentation.
const props = defineProps<{
  sectionTitle: string;
  sectionItems: SidebarItem[];
  activeSectionId: string | null;
  accountName: string;
  /** Menu mode renders the sidebar as a drill-in — the back row returns to
   *  the workspace tree. Absent in tabs mode. */
  showBack?: boolean;
  /** The drilled workspace's header card (the canvas's app card): identity
   *  chip + name + the live status line. Null = the plain section title. */
  workspaceCard?: {
    name: string;
    initials: string;
    statusLine: string;
    /** The status vocabulary key — colours the meta line (one status one
     *  colour). */
    statusTone: "running" | "needs_input" | "problem" | "completed" | "not_running";
  } | null;
}>();

const emit = defineEmits<{
  "select-section": [id: string];
  "open-account": [];
  back: [];
}>();

type SidebarBlock =
  | { kind: "plain"; items: SidebarItem[] }
  | { kind: "group"; id: string; label: string; items: SidebarItem[] };

const blocks = computed<SidebarBlock[]>(() => {
  const built: SidebarBlock[] = [];
  for (const item of props.sectionItems) {
    const last = built.at(-1);
    if (item.group === undefined) {
      if (last?.kind === "plain") last.items.push(item);
      else built.push({ kind: "plain", items: [item] });
    } else if (last?.kind === "group" && last.id === item.group.id) {
      last.items.push(item);
    } else {
      built.push({
        kind: "group",
        id: item.group.id,
        label: item.group.label,
        items: [item],
      });
    }
  }
  return built;
});

// Folded groups persist across launches, like the sidebar width. A corrupt
// stored value falls back to everything-open — losing a fold preference is
// the harmless failure, so no error surfaces.
const STORAGE_KEY = "vynel.sidebar.collapsed-groups";

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

const collapsedGroupIds = ref<Set<string>>(readCollapsed());

function toggleGroup(groupId: string) {
  const next = new Set(collapsedGroupIds.value);
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  collapsedGroupIds.value = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
}

// The active section must never be hidden — navigating into a folded
// group's section (command palette, deep link) unfolds it.
watch(
  () => props.activeSectionId,
  (activeId) => {
    if (activeId === null) return;
    const item = props.sectionItems.find((entry) => entry.id === activeId);
    if (item?.group !== undefined && collapsedGroupIds.value.has(item.group.id))
      toggleGroup(item.group.id);
  },
  { immediate: true },
);
</script>

<template>
  <nav class="flex h-full flex-col bg-panel">
    <div
      v-if="props.sectionItems.length > 0"
      class="min-h-0 flex-1 overflow-y-auto"
    >
      <button
        v-if="props.showBack"
        type="button"
        class="flex w-full cursor-default items-center gap-2 px-3 pb-0.5 pt-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-ink-3 transition hover:text-ink-1"
        @click="emit('back')"
      >
        <ArrowLeft :size="11" class="shrink-0" />
        <span class="truncate">Workspaces</span>
      </button>
      <!-- The drilled app's header card (the canvas): identity chip + name +
           the live status line, on the accent ground. -->
      <div
        v-if="props.workspaceCard"
        class="mx-2 mb-1.5 mt-0.5 flex items-center gap-2 rounded-sm bg-[var(--color-accent-900)] px-2 py-1.5"
        data-testid="sidebar-workspace-card"
      >
        <span
          class="grid size-5 shrink-0 place-items-center rounded-[4px] bg-[var(--color-accent-600)] text-[9px] font-semibold text-[var(--color-accent-100)]"
        >
          {{ props.workspaceCard.initials }}
        </span>
        <span class="flex min-w-0 flex-col">
          <span class="truncate text-[13px] leading-tight text-[var(--color-accent-100)]">
            {{ props.workspaceCard.name }}
          </span>
          <span
            class="workspace-card-meta truncate text-[10.5px] leading-snug"
            :data-status="props.workspaceCard.statusTone"
          >
            {{ props.workspaceCard.statusLine }}
          </span>
        </span>
      </div>
      <p
        v-else
        class="px-4 pb-0.5 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-3"
      >
        {{ props.sectionTitle }}
      </p>
      <template v-for="(block, index) in blocks" :key="index">
        <button
          v-if="block.kind === 'group'"
          type="button"
          class="group-header flex w-full cursor-default items-center gap-1 px-3 pb-0 pt-1 text-left text-2xs font-semibold uppercase tracking-wider text-ink-3 transition hover:text-ink-2"
          :aria-expanded="!collapsedGroupIds.has(block.id)"
          @click="toggleGroup(block.id)"
        >
          <ChevronRight
            :size="11"
            class="shrink-0 transition-transform"
            :class="collapsedGroupIds.has(block.id) ? '' : 'rotate-90'"
          />
          <span class="truncate">{{ block.label }}</span>
        </button>
        <ul
          v-if="block.kind === 'plain' || !collapsedGroupIds.has(block.id)"
          class="grid gap-px px-2"
        >
          <li v-for="item in block.items" :key="item.id">
            <button
              type="button"
              class="flex w-full cursor-default items-center gap-2.5 rounded-sm px-2.5 py-[3px] text-left text-sm transition"
              :class="
                item.id === props.activeSectionId
                  ? 'bg-row-active font-medium text-ink-1'
                  : 'text-ink-2 hover:bg-row-hover hover:text-ink-1'
              "
              :aria-current="item.id === props.activeSectionId ? 'page' : undefined"
              @click="emit('select-section', item.id)"
            >
              <component :is="item.icon" v-if="item.icon" class="size-4 shrink-0 text-ink-3" />
              <span class="flex-1 truncate">{{ item.label }}</span>
            </button>
          </li>
        </ul>
      </template>
    </div>
    <div v-else class="flex-1" />

    <SidebarAccountRow
      :account-name="props.accountName"
      @open-account="emit('open-account')"
    />
  </nav>
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
