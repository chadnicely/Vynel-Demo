<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { PhArrowLeft as ArrowLeft } from "@phosphor-icons/vue";
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from "@vynel/contracts/chat/sessions-overview";
import { useSessionsLibrary } from "../../composables/sessions/use-sessions-library.js";
import { useSessionStatuses } from "../../composables/sessions/use-session-statuses.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import SidebarWorkspaceCard, {
  type SidebarWorkspaceCardModel,
} from "../shell/SidebarWorkspaceCard.vue";
import SessionRow from "./SessionRow.vue";

// The Sessions library AS the sidebar (Kafi, 2026-08-24): the same drill the
// workspace tree does — open a room and the column becomes its menus, open
// Sessions and the column becomes its conversations: "← All Menus" on top,
// the room's own tile under it (the same one its menus wear — the column is
// still the room's), then the rows. The old middle list panel is gone; the
// pane beside this column is the selected conversation. Data-blind about
// what a click MEANS — the shell decides (use-sessions-navigation); this
// lists.
//
// Scope: a workspace (`workspaceScopeId`) lists the room's conversation + its
// sessions; null lists ONLY the global root's own child sessions (the brain's
// own thread IS the Chat nav).
const props = defineProps<{
  workspaceScopeId: string | null;
  /** The room's header tile (the drilled menu's) — null on the global
   *  library, which has no room to name. */
  workspaceCard?: SidebarWorkspaceCardModel | null;
  /** The conversation open in the pane (its entry id) — marks its row. */
  activeSessionId: string | null;
}>();

const emit = defineEmits<{
  back: [];
  open: [entry: SessionsOverviewEntry];
  "open-segment": [entry: SessionsOverviewEntry, segment: SessionsOverviewSegment];
}>();

// PAGED (2026-08-17): the scope curates server-side so each page is dense,
// and the sentinel below asks for the next one as it comes into view.
const { query: libraryQuery, entries } = useSessionsLibrary(
  () => props.workspaceScopeId,
);

const errorText = computed(() =>
  libraryQuery.isError.value ? formatSdkError(libraryQuery.error.value) : null,
);

// Each row's status light — the ONE derivation every surface reads, fed THIS
// list's pages, so a conversation scrolled in on page three lights up like any
// other; the shared overview only knows the first 50.
const sessionStatuses = useSessionStatuses(entries);

// The open conversation's row — matched through its whole chain, so a swap
// mid-view (the route still names the segment that was clicked) keeps the
// row lit instead of losing it.
function isActive(entry: SessionsOverviewEntry): boolean {
  const activeId = props.activeSessionId;
  if (activeId === null) return false;
  return (
    entry.sessionId === activeId ||
    entry.segments.some((segment) => segment.sessionId === activeId)
  );
}

// ── Infinite scroll ────────────────────────────────────────────────
// An IntersectionObserver on a sentinel under the last row, rather than a
// scroll listener: it fires once when the row enters, costs nothing while
// idle, and needs no scroll maths.
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

watch(sentinel, (element) => {
  observer?.disconnect();
  observer = null;
  if (element === null) return;
  observer = new IntersectionObserver((records) => {
    if (!records.some((record) => record.isIntersecting)) return;
    if (libraryQuery.hasNextPage.value && !libraryQuery.isFetchingNextPage.value) {
      void libraryQuery.fetchNextPage();
    }
  });
  observer.observe(element);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <!-- Same column as the menus: `--color-bg` ground, the container padded
       `16.8px 8.4px` so every child sits inset on the hairline. -->
  <nav
    class="sessions-sidebar flex h-full flex-col bg-[var(--color-bg)] px-[8.4px] py-[16.8px] text-[12.5px]"
  >
    <button
      type="button"
      class="sessions-back flex w-full cursor-default items-center gap-[9px] py-[5px] pl-[11.2px] pr-[11.2px] text-left text-[11.5px] text-[var(--color-neutral-500)] transition hover:text-[var(--color-accent)]"
      @click="emit('back')"
    >
      <ArrowLeft :size="12" class="shrink-0" />
      <span class="truncate">All Menus</span>
    </button>
    <SidebarWorkspaceCard v-if="props.workspaceCard" :card="props.workspaceCard" />
    <p
      class="pb-[5px] pl-[10px] pr-[11.2px] pt-[7px] text-[10px] uppercase tracking-[0.12em] text-[var(--color-neutral-600)]"
    >
      Sessions
    </p>

    <div class="list-body flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      <p v-if="libraryQuery.isPending.value" class="state-note">
        Loading conversations…
      </p>

      <p v-else-if="errorText" class="state-note is-error">{{ errorText }}</p>

      <p v-else-if="entries.length === 0" class="state-note">
        No conversations yet — sessions you spin up land here.
      </p>

      <template v-else>
        <SessionRow
          v-for="entry in entries"
          :key="entry.sessionId"
          :entry="entry"
          :is-active="isActive(entry)"
          :status="sessionStatuses.statusFor(entry.sessionId)"
          @open="emit('open', entry)"
          @open-segment="(segment) => emit('open-segment', entry, segment)"
        />
        <!-- Crossing into view asks for the next page. -->
        <div v-if="libraryQuery.hasNextPage.value" ref="sentinel" class="sentinel">
          <span v-if="libraryQuery.isFetchingNextPage.value">Loading more…</span>
        </div>
      </template>
    </div>
  </nav>
</template>

<style scoped>
.sentinel {
  display: flex;
  justify-content: center;
  padding: 10px 0 16px;
  color: var(--ink-3);
  font: 400 11px var(--font-ui);
}

.state-note {
  margin: 16px 8px 0;
  text-align: center;
  color: var(--ink-3);
  font: 400 12px/1.5 var(--font-ui);
}

.state-note.is-error {
  color: var(--danger);
}
</style>
