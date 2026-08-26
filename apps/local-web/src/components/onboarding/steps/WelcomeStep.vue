<script setup lang="ts">
import type { WelcomeStepInput } from "@vynel/contracts/onboarding/onboarding-step-inputs";
import StepActions from "../StepActions.vue";

// Screen 1 — Chad's Welcome prototype copy (2026-08-24), with two of his
// lines deliberately not taken because they are no longer true here:
//
//  - "Two accounts to connect and one project to point us at" — setup
//    connects a brain and (optionally) GitHub; the project question comes
//    AFTER the finish line, not during setup.
//  - "Claude, Codex or Kimi" — only Claude is wired up. The brain step shows
//    the other two as "Not yet"; promising all three on the first screen
//    would be a lie the user finds out about three screens later.
//
// The first promise is his, kept word for word and kept FIRST for his reason:
// it is the thing people brace for and are relieved not to be asked.
const props = defineProps<{
  busy?: boolean;
}>();

const emit = defineEmits<{
  submit: [input: WelcomeStepInput];
}>();
</script>

<template>
  <form class="welcome" @submit.prevent="emit('submit', { acknowledged: true })">
    <p class="lede">
      Vynel builds software with you, then looks after it. An account to
      connect and a few questions, and you are going. About three minutes.
    </p>

    <ul class="promises">
      <li>
        <span class="promise-title">Your projects stay where they are</span>
        <span class="promise-body"
          >No folder to choose and nothing to move. Point Vynel at a project
          wherever it already sits and it looks after it there.</span
        >
      </li>
      <li>
        <span class="promise-title">It builds with your own AI account</span>
        <span class="promise-body"
          >Your own Claude subscription does the building, so there is nothing
          extra to pay for each project.</span
        >
      </li>
      <li>
        <span class="promise-title">Nothing is ever lost</span>
        <span class="promise-body"
          >Every project keeps its full history, so anything can be undone and
          a lost laptop never means a lost business.</span
        >
      </li>
    </ul>

    <StepActions primary-label="Let’s go" :busy="props.busy" />
  </form>
</template>

<style scoped>
.lede {
  margin: 0 0 18px;
  color: var(--ink-2);
  font: 400 13.5px/1.65 var(--font-ui);
}

.promises {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.promises li {
  display: grid;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
}

.promise-title {
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
}

.promise-body {
  color: var(--ink-3);
  font: 400 12px/1.55 var(--font-ui);
}
</style>
