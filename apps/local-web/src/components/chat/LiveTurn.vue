<script setup lang="ts">
import { computed } from "vue";
import {
  ApprovalCard,
  ClaudeMark,
  MessageRow,
  ThinkingBlock,
  ToolCallList,
  MarkdownText,
} from "@vynel/ui";
// The pure taxonomy the server itself records with — same function, so the
// inline card and the notifier card always classify identically.
import { deriveActionKind } from "@vynel/approvals/action-kind";
import {
  liveClockStartMs,
  type ActiveTurnContinuation,
  type ActiveTurnSegment,
  type ActiveTurnView,
} from "../../composables/chat/active-turn-view.js";
import { useTickingElapsed } from "../../composables/chat/use-ticking-elapsed.js";

// The in-flight turn: everything the assistant is doing RIGHT NOW —
// thinking, answer text typing in, tool cards appearing, approvals pausing
// the stream. The gold cursor marks the live edge.
const props = withDefaults(
  defineProps<{
    view: ActiveTurnView;
    /** Who is streaming — matches MessageRow's settled label for the surface. */
    authorLabel?: string;
    /** The persona's custom avatar; null = the Claude mark (MessageRow's
     *  settled rows render the same glyph). */
    authorIconUrl?: string | null;
  }>(),
  { authorLabel: "Assistant", authorIconUrl: null },
);

const emit = defineEmits<{
  decideApproval: [approvalRequestId: string, decision: "approved" | "denied"];
}>();

// The live edge — only the LAST segment is still being written, so only it
// wears the cursor and a live thinking shimmer. Earlier segments are done and
// render exactly like their settled MessageRow will.
const lastSegmentId = computed(
  () => props.view.segments.at(-1)?.messageId ?? null,
);

// The overlay's rows in order: the segments, with each automatic
// continuation's anchor row ("Continuing after patching context — next: …")
// placed before the segment its output starts at — after every segment while
// it has produced none yet. The settled thread will read the same.
type LiveRow =
  | { key: string; kind: "segment"; segment: ActiveTurnSegment }
  | { key: string; kind: "continuation"; continuation: ActiveTurnContinuation };
function continuationRowsAt(index: number): LiveRow[] {
  return props.view.continuations
    .filter((continuation) => continuation.atSegmentIndex === index)
    .map((continuation) => ({
      key: continuation.userMessage.id,
      kind: "continuation" as const,
      continuation,
    }));
}
const liveRows = computed<LiveRow[]>(() => {
  const rows: LiveRow[] = [];
  props.view.segments.forEach((segment, index) => {
    rows.push(...continuationRowsAt(index));
    rows.push({ key: segment.messageId, kind: "segment", segment });
  });
  // Started continuations with no output yet — after every segment (a
  // continuation is recorded at the segment count of its moment, and
  // segments only grow, so none can sit past the end).
  rows.push(...continuationRowsAt(props.view.segments.length));
  return rows;
});
// What the chip says the assistant is doing — "continuing" names an
// automatic continuation after a checkpoint (the swap landed, work goes on).
const liveChipLabel = computed(() => {
  if (props.view.isThinkingLive) return "thinking";
  return props.view.contextPatch?.phase === "continuing"
    ? "continuing"
    : "working";
});

// How long this turn has been running — ticks beside "working" so a long run
// reads as alive, not frozen (shared clock: the thread's working pill reads
// the same composable).
const isPatchingContext = computed(
  () => props.view.contextPatch?.phase === "patching",
);
const elapsedLabel = useTickingElapsed(
  // The phase's own clock: the swap counts from patching start, a
  // continuation from its start, the whole turn otherwise.
  () => liveClockStartMs(props.view),
  // Keeps ticking through the boundary swap — a "patching context" chip that
  // froze would read as hung.
  () => props.view.status === "streaming" || isPatchingContext.value,
);
</script>

<template>
  <div class="live-turn">
    <p class="role-label">
      <span class="author-avatar" aria-hidden="true">
        <img v-if="props.authorIconUrl" :src="props.authorIconUrl" alt="" />
        <ClaudeMark v-else :size="14" />
      </span>
      {{ props.authorLabel }}
    </p>

    <!-- One block per assistant message, in arrival order — the SAME
         thinking → text → tool-calls shape MessageRow gives the settled row,
         so the thread never reformats when the turn completes. A
         continuation's anchor row sits where its output begins. -->
    <template v-for="row in liveRows" :key="row.key">
      <MessageRow
        v-if="row.kind === 'continuation'"
        :message="row.continuation.userMessage"
        class="continuation-row"
      />
      <div v-else class="segment">
        <ThinkingBlock
          v-if="row.segment.thinking"
          :text="row.segment.thinking"
          :streaming="
            props.view.isThinkingLive &&
            row.segment.messageId === lastSegmentId
          "
        />

        <div v-if="row.segment.text" class="answer">
          <!-- The SAME reply voice MessageRow gives the settled row: the
               thread must not reformat when the turn completes. -->
          <MarkdownText variant="reply" :source="row.segment.text" />
          <span
            v-if="
              props.view.status === 'streaming' &&
              row.segment.messageId === lastSegmentId
            "
            class="stream-cursor"
            aria-hidden="true"
          />
        </div>

        <ToolCallList
          v-if="row.segment.toolCalls.length > 0"
          :tool-calls="row.segment.toolCalls"
          :agent-activity="props.view.agentActivity"
        />
      </div>
    </template>

    <template
      v-for="approval in props.view.approvals"
      :key="approval.approvalRequestId"
    >
      <ApprovalCard
        v-if="!approval.isResolved"
        :tool-name="approval.toolName"
        :tool-input="approval.toolInput"
        :action-kind="deriveActionKind(approval.toolName)"
        @approve="
          emit('decideApproval', approval.approvalRequestId, 'approved')
        "
        @deny="emit('decideApproval', approval.approvalRequestId, 'denied')"
      />
    </template>

    <p v-if="props.view.status === 'interrupted'" class="status-note">
      Stopped — the task was interrupted.
    </p>
    <p v-else-if="props.view.error" class="status-note is-error">
      {{ props.view.error.message }}
    </p>

    <!-- The turn's real state, always at the live edge: what Claude is doing
         right now (thinking vs working) + how long the turn has run. Stays as
         a quiet "done" through the settle window instead of vanishing. -->
    <p v-if="props.view.status === 'streaming'" class="live-status">
      <span class="live-chip"
        >{{ liveChipLabel }} · {{ elapsedLabel }}</span
      >
    </p>
    <!-- The turn is done but its conversation is being continued on a fresh
         context (the boundary swap) — say so instead of a silent "done" that
         sits there for the swap's seconds. -->
    <p v-else-if="props.view.status === 'completed' && isPatchingContext" class="live-status">
      <span class="patching-chip">patching context · {{ elapsedLabel }}</span>
    </p>
    <p v-else-if="props.view.status === 'completed'" class="live-status">
      <span class="done-chip">done · {{ elapsedLabel }}</span>
    </p>
  </div>
</template>

<style scoped>
.live-turn {
  display: grid;
  gap: 8px;
}

/* The continuation anchor row reads like its settled MessageRow will —
   the same component; only the live card's rhythm around it is ours. */
.continuation-row {
  margin-top: 6px;
}

.segment {
  display: grid;
  gap: 8px;
}

.role-label {
  margin: 0;
  display: flex;
  align-items: center;
  /* 7px matches MessageRow's settled label — the author name must not shift
     when the turn completes. */
  gap: 7px;
  /* Byte-identical to MessageRow's settled `.role-label` (canvas: 10px,
     0.14em, weight 400, neutral-400) — the author must not shift when the
     live turn becomes a settled row. Change both or neither. */
  color: var(--color-neutral-400);
  font: 400 10px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.author-avatar {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 9999px;
  overflow: hidden;
  /* The soft identity tint makes the spark read as a colorful chip, not a
     stray glyph — same coral family as the mark itself. */
  background: var(--claude-mark-soft);
}

.author-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.live-status {
  margin: 0;
  display: flex;
  align-items: center;
}

.live-chip {
  color: var(--gold);
  font: 400 10px/1.4 var(--font-ui);
  letter-spacing: 0.05em;
  padding: 1px 7px;
  border: 1px solid var(--gold-soft);
  border-radius: 99px;
  background: var(--gold-soft);
  animation: live-chip-breathe 1.6s var(--ease-out) infinite;
}

.done-chip {
  color: var(--ink-3);
  font: 400 10px/1.4 var(--font-ui);
  letter-spacing: 0.05em;
  padding: 1px 7px;
  border: 1px solid var(--hair);
  border-radius: 99px;
}

/* The boundary swap — the same breathing gold as "working": the conversation
   is being continued on a fresh context, not finished and not hung. */
.patching-chip {
  color: var(--gold);
  font: 400 10px/1.4 var(--font-ui);
  letter-spacing: 0.05em;
  padding: 1px 7px;
  border: 1px solid var(--gold-soft);
  border-radius: 99px;
  background: var(--gold-soft);
  animation: live-chip-breathe 1.6s var(--ease-out) infinite;
}

@keyframes live-chip-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-chip,
  .patching-chip {
    animation: none;
  }
}

/* Ink to match the settled reply's lead — MarkdownText's `reply` variant owns
   the metrics, the caller owns the colour. */
.answer {
  position: relative;
  color: var(--color-neutral-200);
}

.stream-cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  margin-left: 3px;
  vertical-align: -2px;
  background: var(--gold);
  border-radius: 2px;
  animation: cursor-blink 1s steps(2, jump-none) infinite;
}

@keyframes cursor-blink {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stream-cursor {
    animation: none;
  }
}

.status-note {
  margin: 0;
  color: var(--ink-3);
  font: 400 12px/1.5 var(--font-ui);
}

.status-note.is-error {
  color: var(--danger);
}
</style>
