<script setup lang="ts">
import { computed } from "vue";
import type { SessionsOverviewSegment } from "@vynel/contracts/chat/sessions-overview";

// A conversation's continuity chain, oldest → newest: each arrow carries the
// occupancy its predecessor forked at (`A ──83%──▶ B`), the newest segment is
// the live one. The copy sells the product story — the conversation continued
// automatically instead of hitting the limit.
const props = defineProps<{
  /** Ordered oldest → newest (the overview's segment order). */
  segments: SessionsOverviewSegment[];
  /** The entry's window — the denominator every hop percentage shares. */
  contextWindow: number;
}>();

const hops = computed(() =>
  props.segments.map((segment, index) => ({
    segment,
    isLast: index === props.segments.length - 1,
    forkPercent:
      segment.contextTokens === null
        ? null
        : Math.round(
            Math.min(1, segment.contextTokens / props.contextWindow) * 100,
          ),
  })),
);
</script>

<template>
  <div class="session-chain mt-2 border-t border-hair pt-2">
    <p class="m-0 mb-1.5 text-[11px] text-ink-3">
      This conversation continued automatically so it never hit the limit —
      {{ props.segments.length }} parts, one thread.
    </p>
    <div class="flex flex-wrap items-center gap-y-1.5">
      <template v-for="hop in hops" :key="hop.segment.sessionId">
        <span
          class="chain-node inline-flex max-w-44 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
          :class="
            hop.segment.isCurrent
              ? 'is-current border-gold-soft bg-gold-soft text-ink-1'
              : 'border-hair bg-panel text-ink-2'
          "
        >
          <span class="truncate">{{ hop.segment.title }}</span>
          <span
            v-if="hop.segment.isCurrent"
            class="shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-gold"
            >current</span
          >
        </span>
        <span
          v-if="!hop.isLast"
          class="chain-hop inline-flex shrink-0 items-center gap-1 px-1.5 text-[10px] text-ink-3"
          :title="
            hop.forkPercent === null
              ? 'Continued into the next part'
              : `Continued at ${hop.forkPercent}% of the window`
          "
        >
          <span aria-hidden="true">──</span>
          <span v-if="hop.forkPercent !== null" class="chain-hop-percent font-semibold"
            >{{ hop.forkPercent }}%</span
          >
          <span aria-hidden="true">──▶</span>
        </span>
      </template>
    </div>
  </div>
</template>
