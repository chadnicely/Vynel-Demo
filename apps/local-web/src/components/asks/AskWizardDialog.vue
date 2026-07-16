<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Modal } from "@vynel/ui";
import type { AskQuestion } from "@vynel/contracts/asks/ask-questions";
import type { AskRequestResponse } from "@vynel/contracts/asks/ask-http";
import AskQuestionField from "./AskQuestionField.vue";
import {
  buildAnswers,
  emptyDraftFor,
  isQuestionAnswered,
  type AskDraft,
} from "./ask-draft.js";
import { useAnswerAsk } from "../../composables/asks/use-answer-ask.js";
import { useDismissAsk } from "../../composables/asks/use-dismiss-ask.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";

// Claude asked, the turn is waiting: one question per step by default, with a
// "View as form" switch for people who'd rather see the whole thing at once.
// Both layouts share one draft keyed by question id, so toggling never loses
// what's been typed.
const props = defineProps<{
  open: boolean;
  ask: AskRequestResponse;
}>();

const emit = defineEmits<{
  close: [];
}>();

const answerAsk = useAnswerAsk();
const dismissAsk = useDismissAsk();

const viewMode = ref<"wizard" | "form">("wizard");
const stepIndex = ref(0);
const draft = ref<AskDraft>({});

// `immediate` covers a dialog mounted already-open (the create-schedule
// precedent) — and a NEW ask id needs a fresh draft even mid-open.
watch(
  () => [props.open, props.ask.id] as const,
  ([open]) => {
    if (!open) return;
    viewMode.value = "wizard";
    stepIndex.value = 0;
    draft.value = emptyDraftFor(props.ask.questions);
    answerAsk.reset();
    dismissAsk.reset();
  },
  { immediate: true },
);

const questions = computed(() => props.ask.questions);
const questionCount = computed(() => questions.value.length);
const countLabel = computed(() =>
  questionCount.value === 1
    ? "1 quick question"
    : `${questionCount.value} quick questions`,
);
const currentQuestion = computed(
  () => questions.value[stepIndex.value] ?? null,
);
const isLastStep = computed(() => stepIndex.value >= questionCount.value - 1);

function isSatisfied(question: AskQuestion): boolean {
  return (
    question.required === false ||
    isQuestionAnswered(question, draft.value[question.id])
  );
}

const isBusy = computed(
  () => answerAsk.isPending.value || dismissAsk.isPending.value,
);
const canAdvance = computed(
  () => currentQuestion.value !== null && isSatisfied(currentQuestion.value),
);
const canSubmit = computed(
  () => questions.value.every(isSatisfied) && !isBusy.value,
);

// The 400 body is plain-language ("the answers don't fit…") — show it as-is.
const errorMessage = computed(() => {
  const failure = answerAsk.error.value ?? dismissAsk.error.value;
  return failure ? formatSdkError(failure) : null;
});

function submit() {
  if (!canSubmit.value) return;
  answerAsk.mutate(
    { askId: props.ask.id, answers: buildAnswers(questions.value, draft.value) },
    { onSuccess: () => emit("close") },
  );
}

function decideLater() {
  dismissAsk.mutate(props.ask.id, { onSuccess: () => emit("close") });
}

// Modal owns Esc / backdrop / focus-trap; it reports close via update:open.
function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Claude needs your input"
    :description="countLabel"
    size="md"
    @update:open="onOpenChange"
  >
    <div class="flex flex-col gap-3.5 pt-1">
      <div class="flex items-center justify-between">
        <div
          v-if="viewMode === 'wizard'"
          class="flex items-center gap-1.5"
          role="img"
          :aria-label="`Question ${stepIndex + 1} of ${questionCount}`"
        >
          <span
            v-for="(question, index) in questions"
            :key="question.id"
            class="size-1.5 rounded-full transition"
            :class="index === stepIndex ? 'bg-gold' : 'bg-hair-strong'"
          />
        </div>
        <span v-else class="text-[11px] text-ink-3">All questions</span>
        <button
          type="button"
          role="switch"
          :aria-checked="viewMode === 'form'"
          class="flex cursor-default items-center gap-1.5 text-[11.5px] font-medium text-ink-2 transition hover:text-ink-1"
          @click="viewMode = viewMode === 'form' ? 'wizard' : 'form'"
        >
          View as form
          <span
            class="relative h-3.5 w-6 rounded-full border transition"
            :class="
              viewMode === 'form'
                ? 'border-gold bg-gold-soft'
                : 'border-hair-strong bg-panel'
            "
          >
            <span
              class="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full transition-all"
              :class="
                viewMode === 'form' ? 'left-[11px] bg-gold' : 'left-[2px] bg-ink-3'
              "
            />
          </span>
        </button>
      </div>

      <template v-if="viewMode === 'wizard'">
        <p class="m-0 text-[11px] text-ink-3">
          Question {{ stepIndex + 1 }} of {{ questionCount }}
        </p>
        <AskQuestionField
          v-if="currentQuestion"
          :key="currentQuestion.id"
          :question="currentQuestion"
          :model-value="draft[currentQuestion.id] ?? null"
          @update:model-value="(value) => (draft[currentQuestion!.id] = value)"
        />
      </template>
      <template v-else>
        <AskQuestionField
          v-for="question in questions"
          :key="question.id"
          :question="question"
          :model-value="draft[question.id] ?? null"
          @update:model-value="(value) => (draft[question.id] = value)"
        />
      </template>

      <p v-if="errorMessage" class="m-0 text-xs text-danger" role="alert">
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        title="Claude continues without your answers"
        class="mr-auto cursor-default rounded-sm px-2 py-1.5 text-xs font-medium text-ink-3 transition hover:text-ink-1"
        :disabled="isBusy"
        @click="decideLater"
      >
        {{ dismissAsk.isPending.value ? "Letting Claude know…" : "I'll decide later" }}
      </button>
      <template v-if="viewMode === 'wizard'">
        <button
          v-if="stepIndex > 0"
          type="button"
          class="cursor-default rounded-sm border border-hair-strong px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1"
          :disabled="isBusy"
          @click="stepIndex--"
        >
          Back
        </button>
        <button
          v-if="!isLastStep"
          type="button"
          class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
          :disabled="!canAdvance || isBusy"
          @click="stepIndex++"
        >
          Next
        </button>
        <button
          v-else
          type="button"
          class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ answerAsk.isPending.value ? "Sending…" : "Send answers" }}
        </button>
      </template>
      <button
        v-else
        type="button"
        class="cursor-default rounded-sm bg-gold px-4 py-1.5 text-xs font-semibold text-shell transition hover:bg-gold-bright disabled:opacity-55"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ answerAsk.isPending.value ? "Sending…" : "Send answers" }}
      </button>
    </template>
  </Modal>
</template>
