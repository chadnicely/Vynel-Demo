<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { PhArrowLeft, PhArrowRight, PhCheck } from "@phosphor-icons/vue";
import { Modal } from "@vynel/ui";
import type { WorkspaceResponse } from "@vynel/contracts/workspaces/workspace-http";
import StepPlace from "./StepPlace.vue";
import StepIdea from "./StepIdea.vue";
import StepQuestions from "./StepQuestions.vue";
import StepRivals from "./StepRivals.vue";
import StepWants from "./StepWants.vue";
import StepPlan from "./StepPlan.vue";
import StepGoals from "./StepGoals.vue";
import StepStack from "./StepStack.vue";
import StepAccount from "./StepAccount.vue";
import StepCare from "./StepCare.vue";
import StepSessions from "./StepSessions.vue";
import StepDone from "./StepDone.vue";
import {
  WIZARD_COPY,
  WIZARD_LAST,
  WIZARD_STEPS,
  makeEmptyAnswers,
  toBriefAnswers,
  wizardGate,
} from "./wizard-steps.js";
import { provideWizardAnswers } from "./wizard-answers.js";
import { useWizardPlan } from "./use-wizard-plan.js";
import { cleanSiteName } from "./wizard-study.js";
import { KICKER, PRIMARY_BUTTON } from "./wizard-classes.js";
import { useVynel } from "../../../composables/use-vynel.js";
import { useClaudeAuthStatus } from "../../../composables/providers/use-claude-auth-status.js";
import { useGitHubConnection } from "../../../composables/github/use-github-connection.js";
import { useScaffoldWorkspace } from "../../../composables/workspaces/use-scaffold-workspace.js";
import { formatSdkError } from "../../../utils/format-sdk-error.js";

// The full-planning road behind New workspace → "Walk me through it": 12
// numbered steps + the Done screen. The folder comes FIRST (Kafi,
// 2026-08-23) — every AI read dispatches from it, never the global space.
// The plan state (studies, synthesis, the fallback, the race guards) lives in
// `useWizardPlan`; this file walks the steps. Finish makes the workspace +
// stores the brief; the USER presses send on the seeded brief — building is
// never a side effect.
const props = defineProps<{
  open: boolean;
  /** The menu-tree group the wizard was opened from; null = the tree root. */
  groupId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  /** Back from screen 1 — to the door the wizard was opened from. */
  back: [];
  /** The account step's sign-in door — the shell opens the account popup. */
  signIn: [];
  /** The Done screen's "Open my workspace" — the shell opens it, brief seeded. */
  created: [payload: { workspace: WorkspaceResponse; brief: string }];
}>();

const vynel = useVynel();
const scaffold = useScaffoldWorkspace();
const isOpen = computed(() => props.open);
const auth = useClaudeAuthStatus(() => props.open);
const isSignedIn = computed(() => auth.data.value?.isAuthenticated === true);
// The global GitHub sign-in, shown (never chosen) on the account step.
const github = useGitHubConnection(() => props.open);
const githubAccount = computed(() =>
  github.data.value?.isAuthenticated === true
    ? { accountLabel: github.data.value.accountLabel ?? "you" }
    : null,
);

const stepIndex = ref(0);
const stepId = computed(() => WIZARD_STEPS[stepIndex.value] ?? "place");
const copy = computed(() => WIZARD_COPY[stepId.value]);

const answers = reactive(makeEmptyAnswers());
provideWizardAnswers(answers);
const planState = useWizardPlan(answers, () => stepId.value, {
  synthesizePlan: (input) => vynel.workspaces.synthesizePlan(input),
  studyRival: (input) => vynel.workspaces.studyRival(input),
});

const scaffoldError = ref<string | null>(null);
const scaffolded = ref<{
  workspace: WorkspaceResponse;
  git:
    | { kind: "initialized" }
    | { kind: "existing" }
    | { kind: "skipped"; reason: string };
  brief: string;
} | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    stepIndex.value = 0;
    Object.assign(answers, makeEmptyAnswers());
    planState.reset();
    scaffoldError.value = null;
    scaffolded.value = null;
    scaffold.reset();
  },
);

const gate = computed(() =>
  wizardGate(stepId.value, answers, { isSignedIn: isSignedIn.value }),
);

async function finish() {
  const directory = answers.directory;
  if (directory === null) {
    scaffoldError.value = "Pick the folder it will live in first.";
    return;
  }
  scaffoldError.value = null;
  try {
    const made = await scaffold.mutateAsync({
      name: answers.appName.trim(),
      directory,
      ...(props.groupId !== null ? { groupId: props.groupId } : {}),
      answers: toBriefAnswers(answers, planState.leftOut.value),
      plan: planState.plan.value,
    });
    scaffolded.value = {
      workspace: made.workspace as WorkspaceResponse,
      git: made.git,
      brief: made.brief.brief,
    };
    stepIndex.value = WIZARD_LAST;
  } catch (error) {
    scaffoldError.value = formatSdkError(error);
  }
}

function openWorkspace() {
  const made = scaffolded.value;
  if (made === null) return;
  emit("created", { workspace: made.workspace, brief: made.brief });
}

const hasSiteDraft = computed(
  () => cleanSiteName(answers.rivalDraft).length >= 4,
);

const nextLabel = computed(() => {
  const step = stepId.value;
  if (step === "rivals" && hasSiteDraft.value) return "Look into it";
  if (step === "plan" && answers.score !== null && answers.score < 10)
    return "Update the plan";
  if (step === "plan" && answers.score === 10) return "Looks right";
  if (step === "sessions")
    return scaffold.isPending.value ? "Making it…" : "Finish";
  if (step === "done") return "Open my workspace";
  return "Continue";
});

const nextDisabled = computed(() => {
  if (stepId.value === "rivals" && hasSiteDraft.value) return false;
  if (stepId.value === "sessions" && scaffold.isPending.value) return true;
  return gate.value !== null;
});

async function next() {
  const step = stepId.value;
  if (step === "rivals" && hasSiteDraft.value) {
    void planState.studyRival();
    return;
  }
  if (step === "plan" && answers.score !== null && answers.score < 10) {
    const note = answers.changes.trim();
    if (note.length <= 3) return;
    answers.changeRequests.push(note);
    answers.changes = "";
    answers.score = null;
    void planState.synthesize();
    return;
  }
  if (gate.value !== null) return;
  if (step === "sessions") {
    await finish();
    return;
  }
  if (step === "done") {
    openWorkspace();
    return;
  }
  stepIndex.value += 1;
  if (WIZARD_STEPS[stepIndex.value] === "plan") void planState.synthesize();
}

function back() {
  if (stepIndex.value === 0) {
    emit("back");
    return;
  }
  // The Done screen has no way back — the workspace already exists.
  if (stepId.value === "done") return;
  stepIndex.value -= 1;
}

// Modal owns focus-trap / scroll-lock; `persistent` keeps Esc and the
// backdrop from throwing twelve screens of answers away — the X is the one
// way out, and it reports through update:open.
function onOpenChange(open: boolean) {
  if (!open) emit("close");
}
</script>

<template>
  <Modal
    :open="props.open"
    :title="copy.title"
    :description="copy.blurb"
    size="xl"
    persistent
    @update:open="onOpenChange"
  >
    <div class="grid min-h-[52vh] content-start gap-4 pb-2 pt-1">
      <div class="grid gap-2">
        <div class="flex items-center gap-2.5">
          <span :class="KICKER">New workspace</span>
          <span class="flex-1" />
          <span class="text-[11.5px] text-ink-3">{{
            stepId === "done"
              ? "Done"
              : `Step ${stepIndex + 1} of ${WIZARD_LAST}`
          }}</span>
        </div>
        <div class="flex gap-1" aria-hidden="true">
          <span
            v-for="index in WIZARD_LAST"
            :key="index"
            class="h-[3px] flex-1 rounded-full"
            :class="
              index - 1 < stepIndex
                ? 'bg-gold/55'
                : index - 1 === stepIndex
                  ? 'bg-gold shadow-[0_0_8px_var(--gold)]'
                  : 'bg-hair-strong'
            "
          />
        </div>
      </div>

      <StepPlace
        v-if="stepId === 'place'"
        :active="isOpen && stepId === 'place'"
      />
      <StepIdea v-else-if="stepId === 'idea'" />
      <StepQuestions v-else-if="stepId === 'q1'" stage="q1" />
      <StepQuestions v-else-if="stepId === 'q2'" stage="q2" />
      <StepRivals
        v-else-if="stepId === 'rivals'"
        :studies="planState.studies"
        @study="planState.studyRival"
        @remove="planState.removeRival"
      />
      <StepWants v-else-if="stepId === 'wants'" />
      <StepPlan
        v-else-if="stepId === 'plan'"
        :plan="planState.plan.value"
        :synthesizing="planState.isSynthesizing.value"
        :synthesis-failed="planState.synthesisFailed.value"
      />
      <StepGoals v-else-if="stepId === 'goals'" :plan="planState.plan.value" />
      <StepStack v-else-if="stepId === 'stack'" />
      <StepAccount
        v-else-if="stepId === 'account'"
        :status="auth.data.value ?? null"
        :loading="auth.isPending.value"
        :github="githubAccount"
        @sign-in="emit('signIn')"
      />
      <StepCare v-else-if="stepId === 'care'" />
      <StepSessions
        v-else-if="stepId === 'sessions'"
        :plan="planState.plan.value"
      />
      <StepDone
        v-else
        :folder-path="scaffolded?.workspace.path ?? null"
        :git="scaffolded?.git ?? null"
      />
    </div>

    <template #footer>
      <button
        type="button"
        class="inline-flex cursor-default items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 transition hover:bg-row-hover hover:text-ink-1 disabled:opacity-35"
        :disabled="stepId === 'done'"
        :title="
          stepId === 'done'
            ? 'The workspace is already made — carry on forward'
            : undefined
        "
        @click="back"
      >
        <PhArrowLeft :size="13" /> Back
      </button>
      <span class="flex-1" />
      <span v-if="scaffoldError" class="text-[12px] text-danger" role="alert">
        {{ scaffoldError }}
      </span>
      <span
        v-else-if="gate && stepId !== 'done'"
        class="text-[12px] text-ink-3"
        >{{ gate }}</span
      >
      <button
        type="button"
        :class="PRIMARY_BUTTON"
        :disabled="nextDisabled"
        @click="next"
      >
        {{ nextLabel }}
        <PhCheck v-if="stepId === 'sessions' || stepId === 'done'" :size="13" />
        <PhArrowRight v-else :size="13" />
      </button>
    </template>
  </Modal>
</template>
