<script setup lang="ts">
import { ref } from "vue";
import type { ProfileStepInput } from "@vynel/contracts/onboarding/onboarding-step-inputs";
import StepActions from "../StepActions.vue";

const props = defineProps<{
  busy?: boolean;
}>();

const emit = defineEmits<{
  submit: [input: ProfileStepInput];
}>();

// Prefill from the browser — the user corrects instead of typing from scratch.
const displayName = ref("");
const locale = ref(navigator.language || "en-US");
const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone);

const timezoneOptions =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [timezone.value];

function submit() {
  emit("submit", {
    displayName: displayName.value.trim(),
    locale: locale.value.trim(),
    timezone: timezone.value,
  });
}
</script>

<template>
  <form class="profile" @submit.prevent="submit">
    <label class="field">
      <span class="field-label">What should Vynel call you?</span>
      <input
        v-model="displayName"
        type="text"
        required
        maxlength="160"
        placeholder="Your name"
        autofocus
      />
    </label>

    <div class="field-row">
      <label class="field">
        <span class="field-label">Language</span>
        <input
          v-model="locale"
          type="text"
          required
          maxlength="20"
          placeholder="en-US"
        />
        <span class="field-hint">Used for dates and replies.</span>
      </label>

      <label class="field">
        <span class="field-label">Timezone</span>
        <select v-model="timezone" required>
          <option v-for="zone in timezoneOptions" :key="zone" :value="zone">
            {{ zone }}
          </option>
        </select>
        <span class="field-hint">Schedules fire on your clock.</span>
      </label>
    </div>

    <StepActions primary-label="Continue" :busy="props.busy" />
  </form>
</template>
