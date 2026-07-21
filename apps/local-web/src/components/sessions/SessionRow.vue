<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronRight, Eye } from "lucide-vue-next";
import { ContextMeter, PresenceDot } from "@vynel/ui";
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from "@vynel/contracts/chat/sessions-overview";
import { formatContextTooltip } from "../../composables/chat/context-occupancy.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import SessionChain from "./SessionChain.vue";
import { sessionScopeLabel } from "./session-scope-label.js";

// One conversation on the Sessions list: who it belongs to, how full its
// context window is, whether it's working right now, and — for a continued
// conversation — the expandable chain of parts. Clicking the row OPENS the
// conversation (the library's whole point); Watch keeps the live overlay.
const props = defineProps<{
  entry: SessionsOverviewEntry;
  /** A turn is running in this session's scope (the activity feed's truth). */
  isWorking: boolean;
}>();

const emit = defineEmits<{
  open: [];
  openSegment: [segment: SessionsOverviewSegment];
  watch: [];
}>();

const scopeLabel = computed(() => sessionScopeLabel(props.entry));
const hasChain = computed(() => props.entry.segments.length > 1);
const isChainOpen = ref(false);

const meterFraction = computed(() =>
  props.entry.contextTokens === null
    ? null
    : props.entry.contextTokens / props.entry.contextWindow,
);
const meterTooltip = computed(() =>
  props.entry.contextTokens === null
    ? undefined
    : formatContextTooltip(props.entry.contextTokens, props.entry.contextWindow),
);
</script>

<template>
  <div
    class="session-row rounded-lg border border-hair bg-raised p-3 transition hover:border-hair-strong"
  >
    <div class="flex items-center gap-3">
      <button
        type="button"
        class="open-button min-w-0 flex-1 cursor-default rounded-sm text-left"
        :aria-label="`Open ${props.entry.title}`"
        @click="emit('open')"
      >
        <div class="flex items-center gap-2">
          <span
            class="scope-chip inline-flex shrink-0 items-center rounded-full border border-hair-strong px-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-3"
            >{{ scopeLabel }}</span
          >
          <p class="row-title m-0 truncate text-sm font-semibold text-ink-1">
            {{ props.entry.title }}
          </p>
          <span
            v-if="props.isWorking"
            class="working-dot inline-flex shrink-0 items-center gap-1.5 text-[10.5px] font-semibold text-ink-2"
          >
            <PresenceDot state="live" />
            Working…
          </span>
        </div>
        <p class="row-sub m-0 mt-0.5 truncate text-xs text-ink-3">
          {{ formatRelativeTime(props.entry.lastMessageAt) }}
          <template v-if="hasChain">
            · continued {{ props.entry.segments.length - 1 }}×</template
          >
        </p>
      </button>

      <ContextMeter
        v-if="meterFraction !== null"
        class="shrink-0"
        :fraction="meterFraction"
        :tooltip="meterTooltip"
      />

      <button
        type="button"
        class="watch-button inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-hair px-[11px] py-[3px] text-xs font-semibold text-ink-2 transition hover:border-hair-strong hover:bg-row-hover hover:text-ink-1"
        :aria-label="`Watch ${props.entry.title} live`"
        @click="emit('watch')"
      >
        <Eye :size="13" />
        Watch
      </button>

      <button
        v-if="hasChain"
        type="button"
        class="chain-toggle inline-flex shrink-0 cursor-default items-center rounded-md p-1 text-ink-3 transition hover:bg-row-hover hover:text-ink-1"
        :aria-expanded="isChainOpen"
        :aria-label="`Show how ${props.entry.title} continued`"
        @click="isChainOpen = !isChainOpen"
      >
        <ChevronRight
          :size="14"
          class="transition-transform"
          :class="{ 'rotate-90': isChainOpen }"
        />
      </button>
    </div>

    <SessionChain
      v-if="hasChain && isChainOpen"
      :segments="props.entry.segments"
      :context-window="props.entry.contextWindow"
      @open-segment="(segment) => emit('openSegment', segment)"
    />
  </div>
</template>
