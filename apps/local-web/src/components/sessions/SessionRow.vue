<script setup lang="ts">
import { computed, ref } from "vue";
import { PhCaretRight as ChevronRight } from "@phosphor-icons/vue";
import { PresenceDot } from "@vynel/ui";
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from "@vynel/contracts/chat/sessions-overview";
import type { SessionStatusView } from "@vynel/contracts/chat/session-status";
import { formatContextTooltip } from "../../composables/chat/context-occupancy.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import SessionChain from "./SessionChain.vue";

// One plain row on the Sessions list (the old Conversations-panel idiom —
// Chad's "no special menus, it's simple"): name, relative time, a small
// context percentage, a working dot while it runs, and the conversation's
// status mark + its one-line why. Clicking opens the session in the pane
// beside the list; a continued conversation expands its chain.
const props = defineProps<{
  entry: SessionsOverviewEntry;
  /** This row's session is open in the pane. */
  isActive: boolean;
  /** The conversation's derived status (use-session-statuses) — null before
   *  the overview lands. Running renders the live dot; needs_input / problem
   *  / completed render the mark, with the note under the name. */
  status: SessionStatusView | null;
}>();

const emit = defineEmits<{
  open: [];
  openSegment: [segment: SessionsOverviewSegment];
}>();

const hasChain = computed(() => props.entry.segments.length > 1);
const isChainOpen = ref(false);

const contextPercent = computed(() =>
  props.entry.contextTokens === null
    ? null
    : Math.round(
        Math.min(1, props.entry.contextTokens / props.entry.contextWindow) *
          100,
      ),
);
const contextTooltip = computed(() =>
  props.entry.contextTokens === null
    ? undefined
    : formatContextTooltip(props.entry.contextTokens, props.entry.contextWindow),
);

// The row's own status vocabulary — the tree row's marks, per conversation.
const MARK_LABELS = {
  needs_input: "is waiting on you",
  problem: "hit a problem",
  completed: "is completed",
} as const;

const isWorking = computed(() => props.status?.status === "running");

const markStatus = computed<keyof typeof MARK_LABELS | null>(() => {
  const current = props.status?.status;
  return current === "needs_input" ||
    current === "problem" ||
    current === "completed"
    ? current
    : null;
});

/** The one-line why — the assistant's note, or the error that stopped it
 *  (e.g. "You've hit your session limit · resets 2:20pm"). */
const statusNote = computed(() =>
  markStatus.value === null ? null : props.status?.note ?? null,
);
</script>

<template>
  <div class="session-item">
    <div class="flex items-center">
      <button
        type="button"
        class="session-row min-w-0 flex-1 cursor-default rounded-sm px-2.5 py-2 text-left transition hover:bg-row-hover"
        :class="{ 'is-active bg-row-active': props.isActive }"
        :aria-label="`Open ${props.entry.title}`"
        @click="emit('open')"
      >
        <span class="flex items-center gap-2">
          <span class="session-title min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-1">
            {{ props.entry.title }}
          </span>
          <span
            v-if="isWorking"
            class="working-dot inline-flex shrink-0 items-center"
            aria-label="Working"
          >
            <PresenceDot state="live" />
          </span>
          <!-- One status, one colour — the tree row's mark, per conversation. -->
          <span
            v-else-if="markStatus"
            class="session-mark size-2 shrink-0 rounded-full"
            :data-status="markStatus"
            :aria-label="`${props.entry.title} ${MARK_LABELS[markStatus]}`"
          />
          <span
            v-if="contextPercent !== null"
            class="context-percent shrink-0 text-[10.5px] font-semibold text-ink-3"
            :title="contextTooltip"
            >{{ contextPercent }}%</span
          >
        </span>
        <span class="session-sub mt-0.5 block truncate text-[11px] text-ink-3">
          {{ formatRelativeTime(props.entry.lastMessageAt) }}
          <template v-if="hasChain">
            · continued {{ props.entry.segments.length - 1 }}×</template
          >
        </span>
        <!-- The why, in the assistant's own words (or the error that stopped
             it) — the reason a red dot is worth looking at. -->
        <span
          v-if="statusNote"
          class="session-note mt-0.5 block truncate text-[11px]"
          :data-status="markStatus"
          >{{ statusNote }}</span
        >
      </button>

      <button
        v-if="hasChain"
        type="button"
        class="chain-toggle inline-flex shrink-0 cursor-default items-center rounded-sm p-1 text-ink-3 transition hover:bg-row-hover hover:text-ink-1"
        :aria-expanded="isChainOpen"
        :aria-label="`Show how ${props.entry.title} continued`"
        @click="isChainOpen = !isChainOpen"
      >
        <ChevronRight
          :size="13"
          class="transition-transform"
          :class="{ 'rotate-90': isChainOpen }"
        />
      </button>
    </div>

    <SessionChain
      v-if="hasChain && isChainOpen"
      class="px-2.5"
      :segments="props.entry.segments"
      :context-window="props.entry.contextWindow"
      @open-segment="(segment) => emit('openSegment', segment)"
    />
  </div>
</template>

<style scoped>
/* One status, one colour — the same marks the tree row wears (tokens, pulse
   and reduced-motion rule included), so a conversation reads the same in the
   list as its room does in the sidebar. */
.session-mark {
  animation: session-mark-pulse 1.4s ease-in-out infinite;
}

.session-mark[data-status="needs_input"],
.session-note[data-status="needs_input"] {
  color: var(--needs-input);
  background: var(--needs-input);
}

.session-mark[data-status="problem"],
.session-note[data-status="problem"] {
  color: var(--danger);
  background: var(--danger);
}

.session-mark[data-status="completed"],
.session-note[data-status="completed"] {
  color: var(--ok);
  background: var(--ok);
}

/* The note is TEXT in the state's hue — the shared rules above set both
   properties, so it must not paint a filled block behind the words. */
.session-note {
  background: none;
}

@keyframes session-mark-pulse {
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
  .session-mark {
    animation: none;
  }
}
</style>
