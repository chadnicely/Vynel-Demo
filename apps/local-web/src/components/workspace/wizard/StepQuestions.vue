<script setup lang="ts">
import { computed } from "vue";
import { useWizardAnswers } from "./wizard-answers.js";
import WizardChip from "./WizardChip.vue";
import { FIELD_LABEL, HINT, INPUT } from "./wizard-classes.js";

// Screens 3 + 4 — the five quick questions, one list per screen. Choice
// questions are chip rows; the one text question is a plain input. The
// "remembers" question is multi-pick.
const props = defineProps<{ stage: "q1" | "q2" }>();

const answers = useWizardAnswers();

type Question =
  | {
      key: "who" | "signin" | "where";
      label: string;
      hint: string;
      options: string[];
    }
  | { key: "first"; label: string; hint: string; placeholder: string }
  | {
      key: "remembers";
      label: string;
      hint: string;
      options: string[];
      multi: true;
    };

const QUESTIONS: Record<"q1" | "q2", Question[]> = {
  q1: [
    {
      key: "who",
      label: "Who's going to use it?",
      hint: "This changes almost everything else, so it comes first.",
      options: ["Just me", "My team", "My customers", "Anyone on the internet"],
    },
    {
      key: "first",
      label: "What should someone be able to do straight away?",
      hint: "One sentence. The single most important thing.",
      placeholder: "Book a table for a date and time",
    },
    {
      key: "signin",
      label: "Do people need to sign in?",
      hint: "Pick the simplest one that's true.",
      options: [
        "No, open to everyone",
        "Yes, their own account",
        "One shared password",
      ],
    },
  ],
  q2: [
    {
      key: "where",
      label: "Where should it live?",
      hint: "You can add the other later.",
      options: ["A website", "A phone app", "Both"],
    },
    {
      key: "remembers",
      label: "What does it need to keep track of?",
      hint: "Pick as many as apply.",
      options: [
        "People",
        "Bookings",
        "Products",
        "Messages",
        "Payments",
        "Photos",
      ],
      multi: true,
    },
  ],
};

const questions = computed(() => QUESTIONS[props.stage]);

function isOn(question: Question, option: string): boolean {
  if (question.key === "remembers") return answers.remembers.includes(option);
  if (question.key === "first") return false;
  return answers[question.key] === option;
}

function pick(question: Question, option: string) {
  if (question.key === "remembers") {
    const list = answers.remembers;
    const at = list.indexOf(option);
    if (at >= 0) list.splice(at, 1);
    else list.push(option);
    return;
  }
  if (question.key !== "first") answers[question.key] = option;
}
</script>

<template>
  <div class="grid gap-5">
    <div v-for="question in questions" :key="question.key" class="grid gap-2">
      <div class="grid gap-0.5">
        <span :class="FIELD_LABEL">{{ question.label }}</span>
        <span :class="HINT">{{ question.hint }}</span>
      </div>
      <input
        v-if="question.key === 'first'"
        v-model="answers.first"
        type="text"
        :class="INPUT"
        :placeholder="question.placeholder"
        :aria-label="question.label"
      />
      <div
        v-else
        class="flex flex-wrap gap-1.5"
        role="group"
        :aria-label="question.label"
      >
        <WizardChip
          v-for="option in question.options"
          :key="option"
          :on="isOn(question, option)"
          @click="pick(question, option)"
        >
          {{ option }}
        </WizardChip>
      </div>
    </div>
  </div>
</template>
