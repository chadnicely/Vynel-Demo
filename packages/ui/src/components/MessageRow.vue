<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import MarkdownText from "./MarkdownText.vue";
import ThinkingBlock from "./ThinkingBlock.vue";
import PresenceDot from "./PresenceDot.vue";
import { workspaceAccentVar } from "../lib/workspace-color.js";

const props = withDefaults(
  defineProps<{
    message: ChatMessageResponse;
    /** True while the linked session is streaming — the chip pulses gold. */
    linkedSessionLive?: boolean | undefined;
    /** A Watch chip means "work happening on ANOTHER session" (the global thread
     *  watching a delegation). Inside the transcript where the work itself lives
     *  (the workspace chat's routed exchange) the chip is noise — pass false to
     *  suppress it. Explicit default: an absent Boolean prop casts to false, which
     *  would silently suppress every chip. */
    showWatchChip?: boolean;
    /** The surface's own assistant author — ordinary rows carry no sourceKind,
     *  so the host names who speaks here (the global thread passes "Claude",
     *  a workspace room its manager persona). */
    assistantName?: string;
  }>(),
  { linkedSessionLive: undefined, showWatchChip: true, assistantName: "Assistant" },
);

const emit = defineEmits<{
  /** The delegation chip: open the linked session's live view. */
  openSession: [sessionId: string];
}>();

// The author line comes from sourceKind (who WROTE this); sourceLabel alone
// may just name a delegation target for the chip below — never the author.
// Authors speak in first person: the global brain IS Claude (the product
// never brands over it), a workspace persona speaks by its own label
// ("Noah · vynel") — never "Assistant · X".
const roleLabel = computed(() => {
  if (props.message.role === "user") {
    return props.message.sourceKind === "global-root" ? "From Claude" : "You";
  }
  if (props.message.sourceKind === "global-root") return "Claude";
  if (
    (props.message.sourceKind === "workspace-manager" ||
      props.message.sourceKind === "agent") &&
    props.message.sourceLabel
  ) {
    return props.message.sourceLabel;
  }
  return props.assistantName;
});

const isAssistant = computed(() => props.message.role === "assistant");

const linkedSessionId = computed(() =>
  props.showWatchChip ? (props.message.partialSessionId ?? null) : null,
);

// A report bubbled up from a workspace/agent wears that workspace's stable
// accent (left bar + chip tint) so it reads as belonging to it. Gated on the
// same signal as the Watch chip: the accent marks work from ANOTHER session, so
// inside the workspace's own room (showWatchChip=false) it's noise — suppress
// it. The global brain and the user stay neutral regardless.
const accentVar = computed(() => {
  const { role, sourceKind, sourceLabel } = props.message;
  const isWorkspaceReport =
    props.showWatchChip &&
    role === "assistant" &&
    (sourceKind === "workspace-manager" || sourceKind === "agent") &&
    !!sourceLabel;
  return isWorkspaceReport ? workspaceAccentVar(sourceLabel!) : null;
});
</script>

<template>
  <div
    class="message-row"
    :class="[`role-${props.message.role}`, { 'has-accent': accentVar }]"
    :style="accentVar ? { '--accent': accentVar } : undefined"
  >
    <p class="role-label">{{ roleLabel }}</p>

    <ThinkingBlock
      v-if="props.message.thinkingBody"
      :text="props.message.thinkingBody"
      class="thinking"
    />

    <MarkdownText v-if="isAssistant" :source="props.message.body" />
    <p v-else class="plain-body">{{ props.message.body }}</p>

    <button
      v-if="linkedSessionId"
      type="button"
      class="session-link"
      @click="emit('openSession', linkedSessionId)"
    >
      <PresenceDot :state="props.linkedSessionLive ? 'live' : 'idle'" />
      <span class="session-link-label">
        {{
          props.message.sourceLabel
            ? `Watch ${props.message.sourceLabel}`
            : "Watch this session"
        }}
      </span>
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 4l4 4-4 4"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <p v-if="props.message.errorMessage" class="error-note">
      {{ props.message.errorMessage }}
    </p>

    <slot name="tool-calls" />
  </div>
</template>

<style scoped>
.message-row {
  display: grid;
  gap: 6px;
}

/* The workspace accent bar — a rounded rule down the left edge, marking a
   report as belonging to its workspace. Color comes from `--accent`
   (workspace-color.ts), never gold. */
.message-row.has-accent {
  position: relative;
  padding-left: 14px;
}

.message-row.has-accent::before {
  content: "";
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 3px;
  border-radius: 99px;
  background: var(--accent);
}

.role-label {
  margin: 0;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.role-user .role-label {
  color: var(--ink-2);
}

.plain-body {
  margin: 0;
  color: var(--ink-1);
  font: 400 13.5px/1.65 var(--font-ui);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.role-user {
  background: var(--bg-panel);
  border: 1px solid var(--hair);
  border-radius: var(--radius-m);
  padding: 10px 14px;
}

/* The chip carries the workspace accent (its frame), while its PresenceDot
   still glows gold when the linked session is live — presence stays gold,
   identity is the accent. Falls back to gold only where no workspace is known. */
.session-link {
  appearance: none;
  border: 1px solid color-mix(in srgb, var(--accent, var(--gold)) 38%, transparent);
  margin: 0;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--accent, var(--gold)) 12%, transparent);
  color: var(--ink-1);
  font: 600 11.5px/1.5 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.session-link:hover {
  border-color: var(--accent, var(--gold));
}

.session-link:focus-visible {
  outline: 2px solid var(--accent, var(--gold));
  outline-offset: 1px;
}

.session-link svg {
  color: var(--ink-3);
}

.error-note {
  margin: 0;
  color: var(--danger);
  font: 400 12px/1.5 var(--font-ui);
}

.thinking {
  margin-bottom: 2px;
}
</style>
