<script setup lang="ts">
import type { AskQuestion } from "@vynel/contracts/asks/ask-questions";
import type { AskFieldValue } from "./ask-draft.js";

// One question, any type — the same component renders a wizard step and a
// form row, so switching layouts can never change how a value is captured.
const props = defineProps<{
  question: AskQuestion;
  modelValue: AskFieldValue;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: AskFieldValue];
}>();

const PILL_BASE =
  "cursor-default rounded-full border px-3 py-1 text-[11.5px] font-medium transition";
const PILL_ON = "border-gold bg-gold-soft text-ink-1";
const PILL_OFF =
  "border-hair bg-panel text-ink-2 hover:border-hair-strong hover:text-ink-1";

function onTextInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}

function toggleOption(option: string) {
  const current = Array.isArray(props.modelValue) ? props.modelValue : [];
  emit(
    "update:modelValue",
    current.includes(option)
      ? current.filter((entry) => entry !== option)
      : [...current, option],
  );
}
</script>

<template>
  <div class="grid gap-1.5">
    <span class="text-[11.5px] font-semibold text-ink-2">
      {{ question.label }}
      <span
        v-if="question.required === false"
        class="text-[10px] font-medium uppercase tracking-wide text-ink-3"
      >
        optional
      </span>
    </span>
    <p v-if="question.hint" class="m-0 text-[11px] text-ink-3">
      {{ question.hint }}
    </p>

    <input
      v-if="question.type === 'text'"
      type="text"
      :value="typeof modelValue === 'string' ? modelValue : ''"
      :placeholder="question.placeholder"
      :aria-label="question.label"
      class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
      @input="onTextInput"
    />

    <input
      v-else-if="question.type === 'number'"
      type="number"
      :value="typeof modelValue === 'string' ? modelValue : ''"
      :placeholder="question.placeholder"
      :aria-label="question.label"
      class="w-full rounded-sm border border-hair-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink-1 placeholder:text-ink-3"
      @input="onTextInput"
    />

    <div
      v-else-if="question.type === 'choice'"
      role="radiogroup"
      :aria-label="question.label"
      class="flex flex-wrap gap-1.5"
    >
      <button
        v-for="option in question.options"
        :key="option"
        type="button"
        role="radio"
        :aria-checked="modelValue === option"
        :class="[PILL_BASE, modelValue === option ? PILL_ON : PILL_OFF]"
        @click="emit('update:modelValue', option)"
      >
        {{ option }}
      </button>
    </div>

    <div v-else-if="question.type === 'multi-choice'" class="grid gap-1">
      <label
        v-for="option in question.options"
        :key="option"
        class="inline-flex items-center gap-[7px] text-[12.5px] text-ink-1"
      >
        <input
          type="checkbox"
          :checked="Array.isArray(modelValue) && modelValue.includes(option)"
          class="accent-[var(--gold)]"
          @change="toggleOption(option)"
        />
        <span>{{ option }}</span>
      </label>
    </div>

    <div v-else class="flex gap-1.5">
      <button
        type="button"
        :aria-pressed="modelValue === true"
        :class="[PILL_BASE, modelValue === true ? PILL_ON : PILL_OFF]"
        @click="emit('update:modelValue', true)"
      >
        Yes
      </button>
      <button
        type="button"
        :aria-pressed="modelValue === false"
        :class="[PILL_BASE, modelValue === false ? PILL_ON : PILL_OFF]"
        @click="emit('update:modelValue', false)"
      >
        No
      </button>
    </div>
  </div>
</template>
