<script setup lang="ts">
import { ref } from "vue";
import type { NameWorkspaceStepInput } from "@vynel/contracts/onboarding/onboarding-step-inputs";
import StepActions from "../StepActions.vue";

const props = defineProps<{
  busy?: boolean;
}>();

const emit = defineEmits<{
  submit: [input: NameWorkspaceStepInput];
}>();

const name = ref("");

function submit() {
  emit("submit", { name: name.value.trim() });
}
</script>

<template>
  <form @submit.prevent="submit">
    <p class="explain">
      A workspace is a room your assistant works in — its own files, memory,
      and skills. You'll start with one; add more anytime.
    </p>

    <label class="field">
      <span class="field-label">Name your first workspace</span>
      <input
        v-model="name"
        type="text"
        required
        maxlength="120"
        placeholder="e.g. Personal, Bookkeeping, My Shop"
        autofocus
      />
      <span class="field-hint">
        Pick the area of your life or work Vynel should help with first.
      </span>
    </label>

    <StepActions primary-label="Create workspace" :busy="props.busy" />
  </form>
</template>

<!-- .explain is styled by WizardStepBody (the one home for step-shared
     presentation). -->
