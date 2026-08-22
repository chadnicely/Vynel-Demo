<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PhArrowBendDownRight,
  PhCheck,
  PhDatabase,
  PhMinusCircle,
  PhSparkle,
} from "@phosphor-icons/vue";
import type { WorkspacePlan } from "@vynel/contracts/workspaces/workspace-brief";
import { useWizardAnswers } from "./wizard-answers.js";
import WizardChip from "./WizardChip.vue";
import {
  CALLOUT,
  FIELD_LABEL,
  HINT,
  KICKER,
  TEXTAREA,
} from "./wizard-classes.js";

// Screen 7 — the whole plan: the one-liner, the three tabs (What we build /
// It remembers / Left out) with each line's source, and the honest 1–10
// rating that gates Continue. Under 10, "What would make it a 10?" opens and
// the answer is folded into the next synthesis. A polished read that did not
// come is SAID — the plan on screen is then straight from the answers.
const props = defineProps<{
  plan: WorkspacePlan;
  synthesizing: boolean;
  synthesisFailed: boolean;
}>();

const answers = useWizardAnswers();

const tab = ref(0);
const tabs = computed(() => [
  { label: "What we build", count: props.plan.build.length },
  { label: "It remembers", count: props.plan.remembers.length },
  { label: "Left out", count: props.plan.leftOut.length },
]);

const moreHint = computed(() =>
  answers.score === null
    ? ""
    : `You said ${answers.score} out of 10 — what is missing?`,
);

function score(value: number) {
  answers.score = value;
  if (value === 10) answers.changes = "";
}
</script>

<template>
  <div
    v-if="synthesizing"
    class="flex items-center gap-2.5 text-[12px] text-ink-3"
  >
    <span class="size-2 animate-pulse rounded-full bg-gold" />
    <span
      >A more polished read is on the way — this one is straight from your
      answers.</span
    >
  </div>
  <p v-else-if="synthesisFailed" class="m-0 text-[12px] text-ink-3">
    We couldn't get the polished read just now — this plan is straight from your
    answers. Step back and forward to try again.
  </p>

  <div :class="CALLOUT" class="grid gap-1">
    <span :class="KICKER">In one line</span>
    <span class="text-[14px] leading-snug text-ink-1">{{ plan.oneLine }}</span>
  </div>

  <div class="flex gap-1 border-b border-hair" role="tablist">
    <button
      v-for="(entry, index) in tabs"
      :key="entry.label"
      type="button"
      role="tab"
      class="-mb-px cursor-default border-b-2 px-2.5 pb-2 pt-1 text-[12.5px] transition"
      :class="
        tab === index
          ? 'border-gold text-ink-1'
          : 'border-transparent text-ink-3 hover:text-ink-1'
      "
      :aria-selected="tab === index"
      @click="tab = index"
    >
      {{ entry.label }} <span class="text-ink-3">· {{ entry.count }}</span>
    </button>
  </div>

  <div v-if="tab === 0" class="grid gap-0.5">
    <div
      v-for="entry in plan.build"
      :key="entry.text"
      class="flex items-center gap-2.5 px-1 py-1.5 text-[12.5px] text-ink-1"
    >
      <PhCheck :size="14" class="shrink-0 text-gold" />
      <span class="flex-1">{{ entry.text }}</span>
      <span class="text-[11px] text-ink-3">{{ entry.source }}</span>
    </div>
  </div>
  <div v-else-if="tab === 1" class="grid gap-0.5">
    <div
      v-for="entry in plan.remembers"
      :key="entry"
      class="flex items-center gap-2.5 px-1 py-1.5 text-[12.5px] text-ink-1"
    >
      <PhDatabase :size="14" class="shrink-0 text-gold" />
      <span>{{ entry }}</span>
    </div>
  </div>
  <div v-else class="grid gap-0.5">
    <div
      v-for="entry in plan.leftOut"
      :key="entry"
      class="flex items-center gap-2.5 px-1 py-1.5 text-[12.5px] text-ink-3"
    >
      <PhMinusCircle :size="14" class="shrink-0" />
      <span>{{ entry }}</span>
    </div>
    <span
      v-if="plan.leftOut.length === 0"
      class="px-1 py-1.5 text-[12px] text-ink-3"
    >
      Nothing yet — this fills in from the sites you look at.
    </span>
  </div>

  <div v-if="answers.changeRequests.length > 0" class="grid gap-1">
    <span :class="KICKER">And what you asked us to change</span>
    <p
      v-for="note in answers.changeRequests"
      :key="note"
      class="m-0 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2"
    >
      <PhArrowBendDownRight :size="14" class="mt-0.5 shrink-0 text-gold" />
      <span>{{ note }}</span>
    </p>
  </div>

  <p class="m-0 text-[11.5px] text-ink-3">
    If any of this looks off, go back and change your answers — the plan follows
    them.
  </p>

  <div class="grid gap-2.5 border-t border-hair pt-4">
    <div class="grid gap-0.5">
      <span :class="FIELD_LABEL">How is this looking?</span>
      <span :class="HINT"
        >Honestly — 1 is nowhere close, 10 is incredible.</span
      >
    </div>
    <div
      class="flex flex-wrap gap-1.5"
      role="group"
      aria-label="Score out of ten"
    >
      <WizardChip
        v-for="value in 10"
        :key="value"
        :on="answers.score === value"
        @click="score(value)"
      >
        {{ value }}
      </WizardChip>
    </div>
    <div class="flex justify-between text-[11px] text-ink-3">
      <span>1 — nowhere close</span>
      <span>10 — incredible</span>
    </div>

    <div v-if="answers.score !== null && answers.score < 10" class="grid gap-2">
      <div class="grid gap-0.5">
        <span :class="FIELD_LABEL">What would make it a 10?</span>
        <span :class="HINT">{{ moreHint }}</span>
      </div>
      <textarea
        v-model="answers.changes"
        :class="TEXTAREA"
        placeholder="Nobody should have to sign in just to look. And I want to see today's bookings first, not a menu."
        aria-label="What would make it a 10?"
      />
      <p class="m-0 text-[11.5px] text-ink-3">
        We'll fold this into the plan before anything gets built.
      </p>
    </div>

    <div
      v-if="answers.score === 10"
      class="flex items-center gap-2 text-[12.5px] text-gold"
    >
      <PhSparkle :size="16" />
      <span>Then we won't touch a thing. Let's build it.</span>
    </div>
  </div>
</template>
