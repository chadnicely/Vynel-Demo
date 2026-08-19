<script setup lang="ts">
import { computed, ref, watch, type Component } from "vue";
import { PhArrowLeft as ArrowLeft, PhCaretRight as ChevronRight } from "@phosphor-icons/vue";
import { PresenceDot } from "@vynel/ui";
import type { SessionStatusView } from "@vynel/contracts/chat/session-status";
import SidebarAccountRow from "./SidebarAccountRow.vue";

export interface SidebarItem {
  id: string;
  label: string;
  icon?: Component;
  // Consecutive items sharing a group id render under one expandable
  // header; ungrouped items are plain rows (Home / Chat / Sessions,
  // Marketplace, the system rows).
  group?: { id: string; label: string };
  /** How much is in this section (the canvas's right-hand number). Absent =
   *  no honest count for it — the row shows nothing rather than a bare 0. */
  count?: number;
  /** A CONVERSATION lives behind this row (today: Voice chat) — its derived
   *  status wears the same mark the Sessions rows wear. Absent/null = the row
   *  is a plain section and shows nothing. */
  status?: SessionStatusView | null;
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

// The row's status vocabulary — the Sessions row's marks, on a menu row.
const MARK_LABELS = {
  needs_input: "is waiting on you",
  problem: "hit a problem",
  completed: "is completed",
} as const;
type MarkStatus = keyof typeof MARK_LABELS;

function markStatusOf(item: SidebarItem): MarkStatus | null {
  const current = item.status?.status;
  return current === "needs_input" ||
    current === "problem" ||
    current === "completed"
    ? current
    : null;
}

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
  <!-- Same column as the tree: `--color-bg` ground, container padded
       `16.8px 8.4px` so every child sits inset on the hairline. -->
  <nav class="flex h-full flex-col bg-[var(--color-bg)] px-[8.4px] py-[16.8px] text-[12.5px]">
    <div
      v-if="props.sectionItems.length > 0"
      class="min-h-0 flex-1 overflow-y-auto"
    >
      <button
        v-if="props.showBack"
        type="button"
        class="flex w-full cursor-default items-center gap-[9px] py-[5px] pl-[11.2px] pr-[11.2px] text-left text-[11.5px] text-[var(--color-neutral-500)] transition hover:text-[var(--color-accent)]"
        @click="emit('back')"
      >
        <ArrowLeft :size="12" class="shrink-0" />
        <span class="truncate">Workspaces</span>
      </button>
      <!-- The drilled app's header card (the canvas): identity chip + name +
           the live status line, on the accent ground. -->
      <div
        v-if="props.workspaceCard"
        class="mb-[8.4px] mt-0.5 flex items-center gap-[9px] rounded-sm bg-[var(--color-accent-900)] px-[11.2px] py-[7px]"
        data-testid="sidebar-workspace-card"
      >
        <span
          class="grid size-5 shrink-0 place-items-center rounded-[4px] bg-[var(--color-accent-600)] text-[9px] text-[var(--color-accent-100)]"
        >
          {{ props.workspaceCard.initials }}
        </span>
        <span class="flex min-w-0 flex-col gap-px">
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
        class="pb-[5px] pl-[10px] pr-[11.2px] pt-[7px] text-[10px] uppercase tracking-[0.12em] text-[var(--color-neutral-600)]"
      >
        {{ props.sectionTitle }}
      </p>
      <template v-for="(block, index) in blocks" :key="index">
        <!-- Grouping stays (Chad, 2026-08-04) — the headers just wear the
             canvas's quiet eyebrow: 10px, 0.12em, weight 400. -->
        <button
          v-if="block.kind === 'group'"
          type="button"
          class="group-header flex w-full cursor-default items-center gap-2 pb-[5px] pl-[10px] pr-[11.2px] pt-[7px] text-left text-[10px] uppercase tracking-[0.12em] text-[var(--color-neutral-600)] transition hover:text-[var(--color-accent)]"
          :aria-expanded="!collapsedGroupIds.has(block.id)"
          @click="toggleGroup(block.id)"
        >
          <ChevronRight
            :size="10"
            class="shrink-0 transition-transform"
            :class="collapsedGroupIds.has(block.id) ? '' : 'rotate-90'"
          />
          <span class="truncate">{{ block.label }}</span>
        </button>
        <ul
          v-if="block.kind === 'plain' || !collapsedGroupIds.has(block.id)"
          class="grid list-none gap-[2px] pl-0"
        >
          <li v-for="item in block.items" :key="item.id">
            <!-- The canvas's section row: 35px tall, pad `8px 11.2px`, 12px
                 gap, 12.5px ink, 13px icon, accent-900 ground when active. -->
            <button
              type="button"
              class="flex w-full cursor-default items-center gap-3 rounded-sm px-[11.2px] py-2 text-left text-[12.5px] transition"
              :class="
                item.id === props.activeSectionId
                  ? 'bg-[var(--color-accent-900)] text-[var(--color-accent-100)]'
                  : 'text-[var(--color-neutral-400)] hover:bg-row-hover hover:text-ink-1'
              "
              :aria-current="item.id === props.activeSectionId ? 'page' : undefined"
              @click="emit('select-section', item.id)"
            >
              <component
                :is="item.icon"
                v-if="item.icon"
                :size="13"
                class="shrink-0"
                :class="
                  item.id === props.activeSectionId
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-neutral-600)]'
                "
              />
              <span class="flex-1 truncate">{{ item.label }}</span>
              <!-- One status, one colour: the conversation behind this row
                   (Voice chat) wears the Sessions row's mark, and the
                   assistant's one-line why rides the tooltip. -->
              <span
                v-if="item.status?.status === 'running'"
                class="inline-flex shrink-0 items-center"
                :aria-label="`${item.label} is working`"
              >
                <PresenceDot state="live" />
              </span>
              <span
                v-else-if="markStatusOf(item)"
                class="sidebar-mark size-2 shrink-0 rounded-full"
                :data-status="markStatusOf(item)"
                :title="item.status?.note ?? undefined"
                :aria-label="`${item.label} ${MARK_LABELS[markStatusOf(item)!]}`"
              />
              <span
                v-if="item.count !== undefined"
                class="shrink-0 text-[10.5px] tabular-nums text-[var(--color-neutral-600)]"
                >{{ item.count }}</span
              >
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
/* One status, one colour — the same marks the tree row and the Sessions row
   wear (tokens, pulse and reduced-motion rule included), so the Voice chat
   row reads the same as the conversation behind it. */
.sidebar-mark {
  animation: sidebar-mark-pulse 1.4s ease-in-out infinite;
}

.sidebar-mark[data-status="needs_input"] {
  background: var(--needs-input);
}

.sidebar-mark[data-status="problem"] {
  background: var(--danger);
}

.sidebar-mark[data-status="completed"] {
  background: var(--ok);
}

@keyframes sidebar-mark-pulse {
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
  .sidebar-mark {
    animation: none;
  }
}

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
