<script setup lang="ts">
import { ref } from "vue";
import type { IdentitySeedStepInput } from "@vynel/contracts/onboarding/onboarding-step-inputs";
import StepActions from "../StepActions.vue";

// Step 3 — "Help Vynel know you". The answers become the person's first
// memory (user-level: no project exists yet, and they are about the person).
const props = defineProps<{
  busy?: boolean;
}>();

const emit = defineEmits<{
  submit: [input: IdentitySeedStepInput];
}>();

const aboutYouParagraph = ref("");
const workspaceContextAnswer = ref("");
const workingStyleAnswer = ref("");

function submit() {
  const workingStyle = workingStyleAnswer.value.trim();
  emit("submit", {
    aboutYouParagraph: aboutYouParagraph.value.trim(),
    workspaceContextAnswer: workspaceContextAnswer.value.trim(),
    ...(workingStyle.length > 0 ? { workingStyleAnswer: workingStyle } : {}),
  });
}
</script>

<template>
  <form @submit.prevent="submit">
    <p class="explain">
      This becomes your assistant's first memory — the more real you are here,
      the less you'll repeat yourself later.
    </p>

    <label class="field">
      <span class="field-label">Tell Vynel about yourself</span>
      <textarea
        v-model="aboutYouParagraph"
        required
        maxlength="2000"
        rows="3"
        placeholder="Who you are, what you do, what a normal week looks like…"
        autofocus
      ></textarea>
    </label>

    <label class="field">
      <span class="field-label">What should it help with?</span>
      <textarea
        v-model="workspaceContextAnswer"
        required
        maxlength="2000"
        rows="3"
        placeholder="The tasks, files, or routines you want off your plate…"
      ></textarea>
    </label>

    <label class="field">
      <span class="field-label">
        How do you like to work?
        <span class="optional-tag">optional</span>
      </span>
      <textarea
        v-model="workingStyleAnswer"
        maxlength="2000"
        rows="2"
        placeholder="Short answers? Morning summaries? Always ask before sending anything?"
      ></textarea>
    </label>

    <StepActions primary-label="Save and continue" :busy="props.busy" />
  </form>
</template>

<!-- .explain / .field / .optional-tag are styled by WizardStepBody (the one
     home for step-shared presentation). -->
