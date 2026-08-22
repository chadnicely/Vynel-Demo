<script setup lang="ts">
import { ref } from "vue";
import {
  PhArrowUp,
  PhCaretDown,
  PhCaretUp,
  PhPencilSimple,
  PhThumbsUp,
} from "@phosphor-icons/vue";
import type { WorkspacePlan } from "@vynel/contracts/workspaces/workspace-brief";
import { useWizardAnswers } from "./wizard-answers.js";
import {
  CALLOUT,
  CARD,
  FIELD_LABEL,
  KICKER,
  PRIMARY_BUTTON,
  SMALL_BUTTON,
  TEXTAREA,
} from "./wizard-classes.js";

// Screen 8 — the MVP: the nutshell paragraph, the goals as accordions with
// their "N things" counts, and the Yes-that-is-it / Not-quite fork that
// gates Continue. A "Not quite" note is kept, shown back, and rides the
// brief.
defineProps<{ plan: WorkspacePlan }>();

const answers = useWizardAnswers();

const openGoal = ref<number | null>(0);
const isAsking = ref(false);
const note = ref("");

function yes() {
  answers.goalsOk = true;
  isAsking.value = false;
}

function notQuite() {
  answers.goalsOk = false;
  isAsking.value = true;
}

function sendNote() {
  const text = note.value.trim();
  if (text.length < 3) return;
  answers.goalNotes.push(text);
  note.value = "";
  isAsking.value = false;
  answers.goalsOk = true;
}
</script>

<template>
  <div :class="CALLOUT" class="grid gap-1">
    <span :class="KICKER">The MVP, in a nutshell</span>
    <p class="m-0 text-[12.5px] leading-relaxed text-ink-1">
      {{ plan.mvpNutshell }}
    </p>
  </div>

  <div class="grid gap-1.5">
    <div
      v-for="(goal, index) in plan.goals"
      :key="goal.title"
      :class="CARD"
      class="p-0"
    >
      <button
        type="button"
        class="flex w-full cursor-default items-center gap-2.5 px-3.5 py-2.5 text-left"
        :aria-expanded="openGoal === index"
        @click="openGoal = openGoal === index ? null : index"
      >
        <span :class="KICKER">Goal {{ index + 1 }}</span>
        <span class="text-[12.5px] text-ink-1">{{ goal.title }}</span>
        <span class="flex-1" />
        <span class="text-[11px] text-ink-3">
          {{ goal.bullets.length }}
          {{ goal.bullets.length === 1 ? "thing" : "things" }}
        </span>
        <PhCaretUp v-if="openGoal === index" :size="13" class="text-ink-3" />
        <PhCaretDown v-else :size="13" class="text-ink-3" />
      </button>
      <div
        v-if="openGoal === index"
        class="grid gap-1 border-t border-hair px-3.5 py-2.5"
      >
        <p
          v-for="bullet in goal.bullets"
          :key="bullet"
          class="m-0 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2"
        >
          <span class="mt-2 size-1.5 shrink-0 rounded-full bg-gold" />
          <span>{{ bullet }}</span>
        </p>
      </div>
    </div>
  </div>

  <div class="grid gap-2.5 border-t border-hair pt-4">
    <span :class="FIELD_LABEL">Does this sound good for your MVP?</span>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        :class="answers.goalsOk ? PRIMARY_BUTTON : SMALL_BUTTON"
        :aria-pressed="answers.goalsOk"
        @click="yes"
      >
        <PhThumbsUp :size="14" /> Yes, that is it
      </button>
      <button
        type="button"
        :class="SMALL_BUTTON"
        :aria-pressed="isAsking"
        @click="notQuite"
      >
        <PhPencilSimple :size="14" /> Not quite
      </button>
    </div>

    <div v-if="isAsking" class="grid gap-2">
      <textarea
        v-model="note"
        :class="TEXTAREA"
        placeholder="Goal 2 matters more than goal 1 — do that first. And drop the reminders for now."
        aria-label="What is not quite right"
      />
      <div>
        <button
          type="button"
          :class="PRIMARY_BUTTON"
          :disabled="note.trim().length < 3"
          @click="sendNote"
        >
          <PhArrowUp :size="13" /> Send this back
        </button>
      </div>
    </div>

    <div v-if="answers.goalNotes.length > 0" class="grid gap-1">
      <p
        v-for="entry in answers.goalNotes"
        :key="entry"
        class="m-0 text-[12px] leading-relaxed text-ink-2"
      >
        You said: {{ entry }}
      </p>
    </div>
  </div>
</template>
