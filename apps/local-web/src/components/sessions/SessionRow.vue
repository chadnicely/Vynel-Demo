<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronRight } from "lucide-vue-next";
import { PresenceDot } from "@vynel/ui";
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from "@vynel/contracts/chat/sessions-overview";
import { formatContextTooltip } from "../../composables/chat/context-occupancy.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import SessionChain from "./SessionChain.vue";

// One plain row on the Sessions list (the old Conversations-panel idiom —
// Chad's "no special menus, it's simple"): name, relative time, a small
// context percentage, a working dot while it runs. Clicking opens the session
// in the pane beside the list; a continued conversation expands its chain.
const props = defineProps<{
  entry: SessionsOverviewEntry;
  /** This row's session is open in the pane. */
  isActive: boolean;
  /** A turn is running in this session (the activity feed's truth). */
  isWorking: boolean;
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
            v-if="props.isWorking"
            class="working-dot inline-flex shrink-0 items-center"
            aria-label="Working"
          >
            <PresenceDot state="live" />
          </span>
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
