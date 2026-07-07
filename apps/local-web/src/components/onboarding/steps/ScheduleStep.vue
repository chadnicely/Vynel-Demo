<script setup lang="ts">
import { ref } from "vue";
import type { OptionalScheduleStepInput } from "@vynel/contracts/onboarding/onboarding-step-inputs";
import StepActions from "../StepActions.vue";

const props = defineProps<{
  busy?: boolean;
  /** From the profile step — the briefing fires on the user's clock. */
  defaultTimezone?: string | undefined;
}>();

const emit = defineEmits<{
  submit: [input: OptionalScheduleStepInput];
}>();

const wantsBriefing = ref(true);
const fireHour = ref(8);

const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  label: new Date(2026, 0, 1, hour).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }),
}));

function submit() {
  if (!wantsBriefing.value) {
    emit("submit", { kind: "skipped" });
    return;
  }
  emit("submit", {
    kind: "create-morning-briefing",
    fireHour: fireHour.value,
    ...(props.defaultTimezone !== undefined
      ? { timezone: props.defaultTimezone }
      : {}),
  });
}
</script>

<template>
  <form @submit.prevent="submit">
    <p class="explain">
      Last one. Vynel can greet you each morning with what happened overnight
      and what's ahead today.
    </p>

    <div class="choice-cards" role="radiogroup" aria-label="Morning briefing">
      <label class="choice" :class="{ 'is-active': wantsBriefing }">
        <input v-model="wantsBriefing" type="radio" :value="true" />
        <span class="choice-title">Morning briefing</span>
        <span class="choice-body">A short daily update, every morning.</span>
      </label>
      <label class="choice" :class="{ 'is-active': !wantsBriefing }">
        <input v-model="wantsBriefing" type="radio" :value="false" />
        <span class="choice-title">No routine yet</span>
        <span class="choice-body">Set up schedules later, in the app.</span>
      </label>
    </div>

    <label v-if="wantsBriefing" class="field hour-field">
      <span class="field-label">Deliver it at</span>
      <select v-model.number="fireHour">
        <option
          v-for="option in hourOptions"
          :key="option.hour"
          :value="option.hour"
        >
          {{ option.label }}
        </option>
      </select>
      <span v-if="props.defaultTimezone" class="field-hint">
        {{ props.defaultTimezone }} time.
      </span>
    </label>

    <StepActions
      :primary-label="wantsBriefing ? 'Finish setup' : 'Finish without it'"
      :busy="props.busy"
    />
  </form>
</template>

<!-- .explain / .choice* are styled by WizardStepBody (the one home for
     step-shared presentation). -->
<style scoped>
.hour-field {
  margin-top: 14px;
  max-width: 220px;
}
</style>
