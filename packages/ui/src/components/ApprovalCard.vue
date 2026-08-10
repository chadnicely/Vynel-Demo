<script setup lang="ts">
import { computed } from "vue";
import type { ActionKind } from "@vynel/contracts/approvals/approval-http";
import CodeBlock from "./CodeBlock.vue";
import {
  parseDesktopPlanCard,
  tierDisplay,
} from "../tool-cards/desktop-step-presenter.js";

// The approval card — the product's trust primitive. Rendered inline in a
// thread AND as a shell notification (compact), so it must work data-blind:
// everything in via props, decisions out via events. A tool input's
// `description` is the agent explaining WHAT it's doing — that's the card's
// headline; the mechanical "wants to…" sentence demotes to a context line.
// The rest of the input renders readably (a command as a terminal line,
// objects as colored JSON) — never an escaped blob: the user is deciding
// TRUST here, so the card must be legible at a glance while omitting nothing.
const props = defineProps<{
  toolName: string;
  toolInput: unknown;
  actionKind?: ActionKind;
  /** Where this is happening, e.g. a workspace name. Shown in the compact header. */
  contextLabel?: string;
  compact?: boolean;
  /** Disables the buttons while a decision is in flight. */
  busy?: boolean;
}>();

const emit = defineEmits<{
  approve: [];
  deny: [];
}>();

const DANGER_KINDS: ActionKind[] = [
  "file-delete",
  "shell-command",
  "email-send",
];

const isDanger = computed(
  () =>
    props.actionKind !== undefined && DANGER_KINDS.includes(props.actionKind),
);

const actionLabel = computed(() => {
  switch (props.actionKind) {
    case "email-send":
      return "wants to send an email";
    case "file-write":
      return "wants to create a file";
    case "file-edit":
      return "wants to change a file";
    case "file-delete":
      return "wants to delete a file";
    case "calendar-write":
      return "wants to change your calendar";
    case "shell-command":
      return "wants to run a command";
    case "memory-write":
      return "wants to save a memory";
    default:
      return "needs your approval";
  }
});

const inputFields = computed<Record<string, unknown> | null>(() =>
  typeof props.toolInput === "object" &&
  props.toolInput !== null &&
  !Array.isArray(props.toolInput)
    ? (props.toolInput as Record<string, unknown>)
    : null,
);

/** A desktop plan renders as THE plan — goal headline, numbered steps, apps
 *  with tier words, the make-mistakes acknowledgment — because the user is
 *  approving the whole task once, not one tool call. Malformed input falls
 *  back to the generic panes (nothing is ever hidden). */
const desktopPlan = computed(() =>
  props.toolName === "mcp__desktop__propose_desktop_plan"
    ? parseDesktopPlanCard(props.toolInput)
    : null,
);

/** The agent's own explanation of the action — promoted to the headline. */
const descriptionTitle = computed(() => {
  const value = inputFields.value?.["description"];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
});

/** A shell approval's command, shown as a terminal line — not a JSON blob.
 *  An empty/blank command is NOT promoted: it stays visible in the JSON pane
 *  (an empty command is itself decision-relevant — something upstream broke;
 *  promoting it would render nothing and hide that). */
const commandText = computed(() => {
  const value = inputFields.value?.["command"];
  return props.actionKind === "shell-command" &&
    typeof value === "string" &&
    value.trim() !== ""
    ? value
    : null;
});

// Everything not already promoted (the title'd description, the terminal'd
// command, the plan pane's goal/steps/apps) still shows — pretty-printed,
// syntax-colored. Nothing is hidden.
const PLAN_PROMOTED_KEYS = ["goal", "steps", "apps"];
const remainingInputJson = computed(() => {
  if (inputFields.value === null) return null;
  const remaining = Object.fromEntries(
    Object.entries(inputFields.value).filter(
      ([key]) =>
        !(key === "description" && descriptionTitle.value !== null) &&
        !(key === "command" && commandText.value !== null) &&
        !(desktopPlan.value !== null && PLAN_PROMOTED_KEYS.includes(key)),
    ),
  );
  if (Object.keys(remaining).length === 0) return null;
  return JSON.stringify(remaining, null, 2);
});

/** A plain-string input (or anything non-object) keeps the plain pane. */
const inputPreview = computed(() => {
  if (props.toolInput === null || props.toolInput === undefined) return "";
  if (typeof props.toolInput === "string") return props.toolInput;
  if (inputFields.value !== null) return ""; // object → the panes above
  return JSON.stringify(props.toolInput, null, 2);
});

const headline = computed(() => {
  if (desktopPlan.value !== null) return desktopPlan.value.goal;
  const sentence = `Your assistant ${actionLabel.value}${
    props.contextLabel ? ` in ${props.contextLabel}` : ""
  }`;
  return descriptionTitle.value ?? sentence;
});

/** With a description (or a plan's goal) as the headline, the sentence
 *  becomes the context line. */
const contextLine = computed(() => {
  if (desktopPlan.value !== null)
    return "Your assistant wants to run this plan on your desktop";
  return descriptionTitle.value !== null
    ? `Your assistant ${actionLabel.value}${
        props.contextLabel ? ` in ${props.contextLabel}` : ""
      }`
    : null;
});
</script>

<template>
  <div
    class="approval-card"
    :class="{ 'is-danger': isDanger, 'is-compact': props.compact }"
  >
    <div class="header">
      <span class="headline">{{ headline }}</span>
      <span class="tool">{{ props.toolName }}</span>
    </div>
    <p v-if="contextLine" class="context-line">{{ contextLine }}</p>

    <p v-if="commandText" class="command-line">
      <span class="prompt">$</span> {{ commandText }}
    </p>

    <!-- The plan pane — the user reads exactly what will happen, then approves
         ONCE for all of it. -->
    <div v-if="desktopPlan" class="plan-pane">
      <ol class="plan-steps">
        <li v-for="(step, index) in desktopPlan.steps" :key="index">{{ step }}</li>
      </ol>
      <p class="plan-apps">
        <!-- Index key: the same app may appear at two tiers — an app-name key
             would collide on exactly the consent surface. -->
        <span
          v-for="(planApp, index) in desktopPlan.apps"
          :key="index"
          class="plan-app"
        >
          {{ planApp.app }} — {{ tierDisplay(planApp.tier) }}
        </span>
      </p>
    </div>

    <CodeBlock
      v-if="remainingInputJson"
      class="input-json"
      :code="remainingInputJson"
      language="json"
    />
    <pre v-if="inputPreview" class="input-preview">{{ inputPreview }}</pre>

    <div class="actions">
      <button
        type="button"
        class="action approve"
        :disabled="props.busy"
        @click="emit('approve')"
      >
        Approve
      </button>
      <button
        type="button"
        class="action deny"
        :disabled="props.busy"
        @click="emit('deny')"
      >
        Deny
      </button>
    </div>

    <p v-if="desktopPlan" class="plan-acknowledgment">
      AI can make mistakes. Approving runs this whole plan on your computer
      without asking step-by-step.
    </p>
  </div>
</template>

<style scoped>
.approval-card {
  border: 1px solid var(--hair-strong);
  border-left: 3px solid var(--gold);
  border-radius: var(--radius-s);
  background: var(--bg-raised);
  padding: 10px 12px;
  display: grid;
  gap: 8px;
  box-shadow: var(--shadow-raised);
}

.approval-card.is-danger {
  border-left-color: var(--danger);
}

.header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.headline {
  color: var(--ink-1);
  font: 600 12.5px/1.5 var(--font-ui);
}

.tool {
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-mono);
}

.context-line {
  margin: -4px 0 0;
  color: var(--ink-3);
  font: 400 11px/1.5 var(--font-ui);
}

/* The command the user is deciding on — a terminal line, not a JSON blob. */
.command-line {
  margin: 0;
  max-height: 140px;
  overflow: auto;
  padding: 8px 10px;
  background: var(--bg-shell);
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  color: var(--ink-1);
  font: 500 11.5px/1.55 var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}

.command-line .prompt {
  color: var(--ink-3);
}

/* The plan the user is deciding on — a readable checklist, not a JSON blob. */
.plan-pane {
  display: grid;
  gap: 6px;
  max-height: 180px;
  overflow: auto;
  padding: 8px 10px;
  background: var(--bg-shell);
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
}

.plan-steps {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 3px;
  color: var(--ink-1);
  font: 400 12px/1.5 var(--font-ui);
}

.plan-apps {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  color: var(--ink-3);
  font: 500 11px/1.5 var(--font-ui);
}

.plan-acknowledgment {
  margin: 0;
  color: var(--ink-3);
  font: 400 10.5px/1.5 var(--font-ui);
}

.is-compact .plan-pane {
  max-height: 120px;
}

/* Compounded with CodeBlock's root class — outranks its own rules by
   specificity, not CSS emission order. */
.input-json.code-block {
  max-height: 140px;
  font-size: 11.5px;
}

.input-json.code-block :deep(.line) {
  white-space: pre-wrap;
  word-break: break-word;
}

.input-preview {
  margin: 0;
  max-height: 140px;
  overflow: auto;
  padding: 8px 10px;
  background: var(--bg-shell);
  border: 1px solid var(--hair);
  border-radius: var(--radius-s);
  color: var(--ink-2);
  font: 400 11.5px/1.55 var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}

.is-compact .command-line,
.is-compact .input-json,
.is-compact .input-preview {
  max-height: 88px;
}

.actions {
  display: flex;
  gap: 8px;
}

.action {
  appearance: none;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-s);
  padding: 4px 14px;
  font: 600 12px/1.6 var(--font-ui);
  cursor: default;
  background: transparent;
  color: var(--ink-2);
  transition:
    background var(--t-fast) var(--ease-out),
    color var(--t-fast) var(--ease-out);
}

.action:disabled {
  opacity: 0.5;
}

.action.approve {
  background: var(--gold);
  border-color: transparent;
  color: #14171c;
}

.action.approve:hover:not(:disabled) {
  background: var(--gold-bright);
}

.is-danger .action.approve {
  background: var(--danger);
  color: #ffffff;
}

.action.deny:hover:not(:disabled) {
  background: var(--row-hover);
  color: var(--ink-1);
}

.action:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
</style>
