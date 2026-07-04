<script setup lang="ts">
import { computed } from "vue";
import type { ActionKind } from "@vynel/contracts/approvals/approval-http";

// The approval card — the product's trust primitive. Rendered inline in a
// thread AND as a shell notification (compact), so it must work data-blind:
// everything in via props, decisions out via events.
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

const inputPreview = computed(() => {
  if (props.toolInput === null || props.toolInput === undefined) return "";
  if (typeof props.toolInput === "string") return props.toolInput;
  return JSON.stringify(props.toolInput, null, 2);
});
</script>

<template>
  <div
    class="approval-card"
    :class="{ 'is-danger': isDanger, 'is-compact': props.compact }"
  >
    <div class="header">
      <span class="headline">
        Your assistant {{ actionLabel
        }}<template v-if="props.contextLabel">
          in {{ props.contextLabel }}</template
        >
      </span>
      <span class="tool">{{ props.toolName }}</span>
    </div>

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
