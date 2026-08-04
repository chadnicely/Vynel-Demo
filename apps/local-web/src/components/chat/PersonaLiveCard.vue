<script setup lang="ts">
// One in-flight delegation as a PERSON working in the thread (persona-sessions
// B5): avatar + name, live state, the coalesced narration line, the last few
// steps, elapsed — click opens the live watch, the square stops it. Sits at
// the thread's live edge like a typing indicator; it renders ZERO message
// text (the settled ack/report rows own all content — no dedupe contest).
// Tailwind utilities over the shared tokens — no new scoped CSS (the B-arc
// direction).
import { computed, onScopeDispose, ref } from "vue";
import { PresenceDot, formatElapsed } from "@vynel/ui";
import { useCoalescedText } from "../../composables/chat/use-coalesced-text.js";
import type { PersonaLiveCardModel } from "../../composables/delegations/use-live-delegation-cards.js";

const props = defineProps<{ card: PersonaLiveCardModel }>();
const emit = defineEmits<{ open: []; stop: [] }>();

const stateLine = computed(() => {
  if (props.card.state === "queued") return "Queued — starting soon…";
  return props.card.narration ?? (props.card.acked ? "Working…" : "Starting…");
});
const displayedLine = useCoalescedText(() => stateLine.value);

// Elapsed ticks once a second while the card lives.
const nowMs = ref(Date.now());
const elapsedTimer = setInterval(() => {
  nowMs.value = Date.now();
}, 1000);
onScopeDispose(() => clearInterval(elapsedTimer));
const elapsedLabel = computed(() =>
  props.card.startedAt === null
    ? null
    : formatElapsed(new Date(props.card.startedAt).getTime(), nowMs.value),
);

// The last steps BEFORE the current line (which the narration shows) — small
// on purpose; the full activity is one Watch-click away.
const priorSteps = computed(() => props.card.recentSteps.slice(0, -1).slice(-2));
</script>

<template>
  <div
    class="w-full max-w-[760px] mx-auto rounded-[var(--radius-m)] border px-3.5 py-2.5 grid gap-1.5 bg-[var(--bg-panel)]"
    :style="{
      borderColor: `color-mix(in srgb, var(${props.card.persona.accentVar}) 38%, transparent)`,
    }"
    data-testid="persona-live-card"
  >
    <div class="flex items-center gap-2 min-w-0">
      <img
        v-if="props.card.persona.imageUrl"
        :src="props.card.persona.imageUrl"
        alt=""
        class="w-5 h-5 rounded-full object-cover flex-none"
      />
      <span
        v-else
        class="w-5 h-5 rounded-full flex-none grid place-items-center text-[9px] font-semibold text-[var(--ink-1)]"
        :style="{
          background: `color-mix(in srgb, var(${props.card.persona.accentVar}) 30%, transparent)`,
        }"
        >{{ props.card.persona.monogram }}</span
      >
      <span
        class="text-[12.5px] font-semibold text-[var(--ink-1)] truncate"
        data-testid="persona-card-name"
        >{{ props.card.persona.name }}</span
      >
      <PresenceDot :state="props.card.state === 'working' ? 'live' : 'idle'" />
      <span
        v-if="props.card.acked"
        class="flex-none text-[10px] uppercase tracking-[0.07em] text-[var(--ink-3)]"
        >acknowledged</span
      >
      <span
        v-if="elapsedLabel"
        class="ml-auto flex-none text-[10.5px] text-[var(--ink-3)] tabular-nums"
        >{{ elapsedLabel }}</span
      >
      <button
        type="button"
        class="flex-none text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)] hover:text-[var(--ink-1)]"
        data-testid="persona-card-watch"
        @click="emit('open')"
      >
        Watch
      </button>
      <button
        type="button"
        class="flex-none grid place-items-center w-[18px] h-[18px] rounded-full text-[var(--ink-3)] hover:text-[var(--danger)]"
        :aria-label="`Stop: ${props.card.taskLabel}`"
        data-testid="persona-card-stop"
        @click="emit('stop')"
      >
        <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
        </svg>
      </button>
    </div>
    <p class="m-0 text-[11px] text-[var(--ink-3)] truncate">
      {{ props.card.taskLabel }}
    </p>
    <ul v-if="priorSteps.length > 0" class="m-0 p-0 list-none grid gap-0.5">
      <li
        v-for="(step, index) in priorSteps"
        :key="index"
        class="text-[11px] text-[var(--ink-3)] truncate"
      >
        · {{ step.label }}
      </li>
    </ul>
    <Transition name="narration" mode="out-in">
      <p
        :key="displayedLine ?? 'starting'"
        class="m-0 text-[12px] text-[var(--ink-2)] truncate"
        data-testid="persona-card-line"
      >
        {{ displayedLine ?? "Starting…" }}
      </p>
    </Transition>
  </div>
</template>
