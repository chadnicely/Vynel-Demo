<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhCaretRight as ChevronRight,
  PhCircleNotch as CircleNotch,
} from "@phosphor-icons/vue";
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from "@vynel/contracts/chat/sessions-overview";
import type { SessionStatusView } from "@vynel/contracts/chat/session-status";
import { ContextRing } from "@vynel/ui";
import { formatContextTooltip } from "../../composables/chat/context-occupancy.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import SessionChain from "./SessionChain.vue";
import SessionIconBadge from "./SessionIconBadge.vue";

// One row on the Sessions list, in the workspace tree's row language (the
// left menu's idiom, per the user 2026-08-24): the session's face on the
// left — its curated icon, else its monogram over its accent — the name, and
// the state cluster on the RIGHT: context %, then ONE mark (the spinner while
// it works, the status dot when it needs you / broke / completed). The
// relative time rides the row's tooltip: at the sidebar's width (the library
// IS the sidebar now) a visible time label truncated every name. The
// one-line why breathes under the row when a mark is up.
// Clicking opens the session in the pane beside the list; a continued
// conversation expands its chain.
const props = defineProps<{
  entry: SessionsOverviewEntry;
  /** This row's session is open in the pane. */
  isActive: boolean;
  /** The conversation's derived status (use-session-statuses) — null before
   *  the overview lands. Running renders the spinner; needs_input / problem
   *  / completed render the mark, with the note under the row. */
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
        class="session-row grid min-h-[30px] min-w-0 flex-1 cursor-default grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm py-1 pl-[10px] pr-[9px] text-left text-[12.5px] transition"
        :class="
          props.isActive
            ? 'is-active bg-[var(--color-accent-900)] text-[var(--color-accent-100)]'
            : 'text-ink-2 hover:bg-row-hover hover:text-ink-1'
        "
        :aria-label="`Open ${props.entry.title}`"
        :aria-current="props.isActive ? 'page' : undefined"
        :title="`${props.entry.title} · ${formatRelativeTime(props.entry.lastMessageAt)}`"
        @click="emit('open')"
      >
        <SessionIconBadge :name="props.entry.title" :icon="props.entry.icon" />
        <span class="min-w-0 truncate">{{ props.entry.title }}</span>
        <!-- The state cluster, on the right: the quiet number, then ONE mark. -->
        <span class="flex items-center gap-[7px]">
          <!-- The context occupancy as the app's ONE ring (the composer's,
               from @vynel/ui) — the arc fills to the percentage in the
               tier's colour; the number stays for screen readers. -->
          <span
            v-if="contextPercent !== null"
            class="context-percent inline-flex shrink-0 items-center"
            :title="contextTooltip"
          >
            <ContextRing :fraction="contextPercent / 100" :tooltip="contextTooltip" />
            <span class="sr-only">{{ contextPercent }}%</span>
          </span>
          <span
            v-if="isWorking"
            class="working-dot inline-flex shrink-0 items-center"
            aria-label="Working"
          >
            <CircleNotch
              :size="14"
              weight="bold"
              class="animate-spin text-gold"
            />
          </span>
          <!-- One status, one colour — the tree row's mark, per conversation. -->
          <span
            v-else-if="markStatus"
            class="session-mark size-2.5 shrink-0 rounded-full"
            :data-status="markStatus"
            :aria-label="`${props.entry.title} ${MARK_LABELS[markStatus]}`"
          />
        </span>
        <!-- The row's footnotes, aligned under the name: how the conversation
             continued, and the why behind a mark — in the assistant's own
             words (or the error that stopped it). -->
        <span
          v-if="hasChain"
          class="col-span-full block truncate pl-[26px] text-[10.5px] text-[var(--color-neutral-500)]"
        >
          continued {{ props.entry.segments.length - 1 }}×
        </span>
        <span
          v-if="statusNote"
          class="session-note col-span-full block truncate pl-[26px] text-[11px]"
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
/* One status, one colour — the same marks the tree row wears (tokens, ring,
   pulse and reduced-motion rule included), so a conversation reads the same
   in the list as its room does in the sidebar. */
.session-mark {
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent);
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
    opacity: 0.45;
    transform: scale(0.8);
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-mark {
    animation: none;
  }
}
</style>
