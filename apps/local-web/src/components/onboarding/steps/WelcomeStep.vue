<script setup lang="ts">
import type { WelcomeStepInput } from "@vynel/contracts/onboarding/onboarding-step-inputs";
import StepActions from "../StepActions.vue";

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
      Vynel is a personal assistant that actually does things — reads and
      writes files, runs your routines, and reports back. A few questions and
      it's yours.
    </p>

    <ul class="promises">
      <li>
        <span class="promise-title">It remembers</span>
        <span class="promise-body"
          >Who you are and how you like to work — visible, editable
          memory.</span
        >
      </li>
      <li>
        <span class="promise-title">It asks first</span>
        <span class="promise-body"
          >Anything irreversible waits for your approval before it
          happens.</span
        >
      </li>
      <li>
        <span class="promise-title">It's everywhere you are</span>
        <span class="promise-body"
          >Desktop, voice, Telegram — one assistant, one conversation.</span
        >
      </li>
    </ul>

    <StepActions primary-label="Let's set up" :busy="props.busy" />
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
