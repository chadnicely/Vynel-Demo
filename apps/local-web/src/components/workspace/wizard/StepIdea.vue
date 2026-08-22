<script setup lang="ts">
import { useWizardAnswers } from "./wizard-answers.js";
import { FIELD_LABEL, HINT, TEXTAREA } from "./wizard-classes.js";

// Screen 2 — the idea, in their own words. Three example chips for the
// person staring at an empty box.
const answers = useWizardAnswers();

const EXAMPLES = [
  {
    label: "Bookings for my restaurant",
    idea: "A place where my regulars can book a table and see what we have on this week.",
  },
  {
    label: "A shop for my pottery",
    idea: "A small shop where people can browse my pottery, pick a piece and pay for it.",
  },
  {
    label: "Jobs for my two crews",
    idea: "Somewhere my two crews can see the jobs booked in for the week and tick them off as they finish.",
  },
];
</script>

<template>
  <label class="grid gap-1.5">
    <span :class="FIELD_LABEL">Your idea, in your own words</span>
    <textarea
      v-model="answers.idea"
      :class="TEXTAREA"
      placeholder="A place where my regulars can book a table and see what's on this week…"
    />
  </label>

  <div class="grid gap-2">
    <span :class="HINT">Not sure how to start? Try one of these.</span>
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="example in EXAMPLES"
        :key="example.label"
        type="button"
        class="cursor-default rounded-full border border-hair-strong bg-panel px-3 py-1 text-[12px] text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
        @click="answers.idea = example.idea"
      >
        {{ example.label }}
      </button>
    </div>
  </div>
</template>
