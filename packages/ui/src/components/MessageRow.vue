<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import {
  isUpdateMessageBody,
  stripReportMessageMarker,
} from "@vynel/contracts/chat/report-message-marker";
import { deriveMessageOrigin } from "@vynel/contracts/chat/message-origin";
import MarkdownText from "./MarkdownText.vue";
import ThinkingBlock from "./ThinkingBlock.vue";
import PresenceDot from "./PresenceDot.vue";
import AttachmentChips from "./AttachmentChips.vue";
import ClaudeMark from "./ClaudeMark.vue";
import {
  workspaceAccentVar,
  workspaceNameFromLabel,
} from "../lib/workspace-color.js";
import { formatMessageTimestamp } from "../lib/format-timestamp.js";

// Watch chips follow the PIPELINE scoping rule (Chad, 2026-07-21 evening): a
// thread shows chips only for its DIRECT children's work — never for the
// delegation that targeted itself (that's its parent's watch). The row can't
// know which side of that line it sits on, so the host (ThreadStream, which
// sees the whole thread) passes `showWatchChip`. This is NOT the old Slice-④
// per-surface suppression: the accent + author identity always render.
const props = withDefaults(
  defineProps<{
    message: ChatMessageResponse;
    /** True while the linked session is streaming — the chip pulses gold. */
    linkedSessionLive?: boolean | undefined;
    /** False when the row belongs to a delegation that targeted THIS thread
     *  (the parent's watch — pipeline scoping above). Default: chip renders. */
    showWatchChip?: boolean;
    /** The surface's own assistant author — ordinary rows carry no sourceKind,
     *  so the host names who speaks here (the global thread passes "Claude",
     *  a workspace room its manager persona). */
    assistantName?: string;
    /** The surface assistant's custom avatar (a data URL from Customize).
     *  Null falls back to the Claude mark — which also covers every row NOT
     *  authored by the surface's own assistant (reports, global-root). */
    assistantIconUrl?: string | null;
    /** False for an assistant row continuing the previous row's turn — the
     *  host groups consecutive same-author rows under ONE author line, so a
     *  reloaded thread reads like the live overlay (one "Claude:", N blocks). */
    showHeader?: boolean;
    /** The PERSONA-attributed author's visual identity (persona-sessions B8):
     *  the host resolves the row's sourceLabel to an image or monogram, and a
     *  report/update/persona row wears IT instead of the blanket Claude mark.
     *  Null keeps the pre-B8 fallbacks. `accentVar` is the custom-property
     *  NAME (`--ws-3`) — this template wraps it in `var()` itself. */
    authorPersona?: {
      imageUrl: string | null;
      monogram: string;
      accentVar: string;
    } | null;
  }>(),
  {
    linkedSessionLive: undefined,
    showWatchChip: true,
    assistantName: "Assistant",
    assistantIconUrl: null,
    showHeader: true,
    authorPersona: null,
  },
);

const emit = defineEmits<{
  /** The delegation chip: open the linked session's live view. */
  openSession: [sessionId: string];
  /** The report box's "View report/update" chip: open the full text (the
   *  shared review dialog — the plan-card pattern). Content rides along; no
   *  fetch. `kind` keeps the dialog's title honest — an interim update must
   *  never present as the finished result. */
  openReport: [
    report: { sourceLabel: string; body: string; kind: "report" | "update" },
  ];
}>();

// An inbound REPORT — a workspace's or agent's finished result arriving as
// the notify turn's user-role message (session-comms). It must read as ITS
// AUTHOR speaking, never as the user: persona author line, markdown body,
// workspace accent, no "your message" bubble.
const isInboundReport = computed(() => {
  const { role, sourceKind, sourceLabel } = props.message;
  return (
    role === "user" &&
    (sourceKind === "workspace-manager" || sourceKind === "agent") &&
    !!sourceLabel
  );
});

// The author line comes from sourceKind (who WROTE this); sourceLabel alone
// may just name a delegation target for the chip below — never the author.
// Authors speak in first person: the global brain IS Claude (the product
// never brands over it), a workspace persona speaks by its own label
// ("Noah · vynel") — never "Assistant · X".
const roleLabel = computed(() => {
  if (props.message.role === "user") {
    if (props.message.sourceKind === "global-root") return "From Claude";
    if (isInboundReport.value) return props.message.sourceLabel!;
    return "You";
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

// A row spoken BY a named persona (a workspace manager or an agent colleague)
// — either shape: the assistant-role reply or the user-role inbound delivery.
const isPersonaAuthor = computed(
  () =>
    (props.message.sourceKind === "workspace-manager" ||
      props.message.sourceKind === "agent") &&
    !!props.message.sourceLabel &&
    (props.message.role === "assistant" || isInboundReport.value),
);

// The glyph beside authored lines: a persona row wears ITS persona (the
// host-resolved image or monogram — B8), the surface's own assistant its
// custom image, and everything else the Claude mark — it's all Claude
// underneath. Plain user lines get no glyph.
type AuthorGlyph =
  | { kind: "image"; imageUrl: string }
  | { kind: "monogram"; monogram: string; accentVar: string }
  | { kind: "claude" }
  | null;

const authorGlyph = computed<AuthorGlyph>(() => {
  if (props.message.role === "user" && !isInboundReport.value) return null;
  if (isPersonaAuthor.value && props.authorPersona) {
    return props.authorPersona.imageUrl
      ? { kind: "image", imageUrl: props.authorPersona.imageUrl }
      : {
          kind: "monogram",
          monogram: props.authorPersona.monogram,
          accentVar: props.authorPersona.accentVar,
        };
  }
  const speaksAsSurfaceAssistant =
    props.message.role === "assistant" &&
    props.message.sourceKind !== "global-root" &&
    !isPersonaAuthor.value;
  if (speaksAsSurfaceAssistant && props.assistantIconUrl) {
    return { kind: "image", imageUrl: props.assistantIconUrl };
  }
  return { kind: "claude" };
});

// When this message happened — quiet meta beside the author, so a reopened
// conversation reads as a timeline, not an undated wall.
const timeLabel = computed(() =>
  formatMessageTimestamp(props.message.createdAt),
);

// A delivered report carries a first-line attribution marker FOR THE MODEL
// (the notify turn must never mistake it for user input). The card's author
// line already names the reporter, so the marker is stripped for display.
const displayBody = computed(() =>
  isInboundReport.value
    ? stripReportMessageMarker(props.message.body)
    : props.message.body,
);

// The report box is COMPACT (pipeline model, Chad 2026-07-27): a teaser line,
// not the full body — the thread stays a conversation; the full report opens
// in the shared review dialog via the chip below.
const REPORT_TEASER_LIMIT = 180;
const reportTeaser = computed(() => {
  if (!isInboundReport.value) return null;
  const firstLine =
    displayBody.value.split("\n").find((line) => line.trim() !== "") ?? "";
  const plain = firstLine.replace(/[#*_`>]/g, "").trim();
  return plain.length > REPORT_TEASER_LIMIT
    ? `${plain.slice(0, REPORT_TEASER_LIMIT)}…`
    : plain;
});

// A user message that arrived through a channel wears a small "via X" badge —
// origin is HOW it reached the brain (voice daemon, Telegram), distinct from
// who wrote it. The app composer is the default surface: no badge. Keyed on
// the contract union so a new origin member is a compile error here.
const ORIGIN_LABELS: Record<
  NonNullable<ChatMessageResponse["originChannel"]>,
  string
> = {
  voice: "Voice",
  telegram: "Telegram",
  discord: "Discord",
  zoom: "Zoom",
};

// The ONE reading of "who spoke this, from where" (contracts A10) — a
// session-relayed row is never "via Telegram" even if a channel marker rode
// along; only a genuinely user-typed channel message wears the badge. System
// rows sit outside the origin vocabulary (never badged).
const messageOrigin = computed(() => {
  const role = props.message.role;
  if (role !== "user" && role !== "assistant") return null;
  return deriveMessageOrigin({
    role,
    sourceKind: props.message.sourceKind ?? null,
    sourceLabel: props.message.sourceLabel ?? null,
    originChannel: props.message.originChannel ?? null,
  });
});

const originBadge = computed(() => {
  if (messageOrigin.value?.origin !== "channel") return null;
  const kind = props.message.originChannel!;
  return { kind, label: ORIGIN_LABELS[kind] };
});

// An interim UPDATE (the child's spoken ack/progress) wears its own badge —
// it must never read as the finished result.
const isInboundUpdate = computed(
  () => isInboundReport.value && isUpdateMessageBody(props.message.body),
);

const linkedSessionId = computed(() => props.message.partialSessionId ?? null);

// The chip names the actual work when the serve-time enrichment carried the
// delegated task ("vynel · Set up the login page"); the persona-first
// sourceLabel keeps only its workspace segment — the persona already speaks
// in the row's author line. Fallbacks keep the old labels for rows without
// a task (job pruned, pre-enrichment history).
const watchChipLabel = computed(() => {
  const task = props.message.delegationTaskLabel;
  if (task) {
    const workspace = props.message.sourceLabel
      ? workspaceNameFromLabel(props.message.sourceLabel)
      : null;
    return workspace ? `${workspace} · ${task}` : task;
  }
  return props.message.sourceLabel
    ? `Watch ${props.message.sourceLabel}`
    : "Watch this session";
});

// A report bubbled up from a workspace/agent wears that workspace's stable
// accent (left bar + chip tint) so it reads as belonging to it — on every
// surface, the workspace's own room included (chip parity above). This covers
// BOTH shapes a report takes: an assistant-role row (a persona speaking) and
// the user-role inbound of a notify turn (session-comms delivery). The global
// brain and the user stay neutral regardless.
const accentVar = computed(() => {
  const { role, sourceKind, sourceLabel } = props.message;
  const isWorkspaceReport =
    (role === "assistant" || isInboundReport.value) &&
    (sourceKind === "workspace-manager" || sourceKind === "agent") &&
    !!sourceLabel;
  return isWorkspaceReport ? workspaceAccentVar(sourceLabel!) : null;
});
</script>

<template>
  <div
    class="message-row"
    :class="[
      `role-${props.message.role}`,
      { 'has-accent': accentVar, 'is-report': isInboundReport },
    ]"
    :style="accentVar ? { '--accent': accentVar } : undefined"
  >
    <div v-if="props.showHeader" class="row-header">
    <p class="role-label">
      <span
        v-if="authorGlyph"
        class="author-avatar"
        :style="
          authorGlyph.kind === 'monogram'
            ? {
                background: `color-mix(in srgb, var(${authorGlyph.accentVar}) 30%, transparent)`,
              }
            : undefined
        "
        aria-hidden="true"
      >
        <img
          v-if="authorGlyph.kind === 'image'"
          :src="authorGlyph.imageUrl"
          alt=""
        />
        <span v-else-if="authorGlyph.kind === 'monogram'" class="monogram-text">{{
          authorGlyph.monogram
        }}</span>
        <ClaudeMark v-else :size="14" />
      </span>
      {{ roleLabel }}
      <span v-if="originBadge" class="origin-badge">
        <!-- Inline glyphs keep @vynel/ui icon-library-free -->
        <svg
          v-if="originBadge.kind === 'voice'"
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="5.75"
            y="1.5"
            width="4.5"
            height="8"
            rx="2.25"
            stroke="currentColor"
            stroke-width="1.4"
          />
          <path
            d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        </svg>
        <svg
          v-else
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M14.5 1.5L1.5 6.8l4 1.7 1.7 4 2.1-3 3.2 2.3 2-10.3z"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
        </svg>
        via {{ originBadge.label }}
      </span>
      <!-- Quiet provenance mark: this row was DELIVERED, not typed — an
           interim update says so (never mistakable for the finished result). -->
      <span v-if="isInboundReport" class="origin-badge">{{
        isInboundUpdate ? "Update" : "Report"
      }}</span>
    </p>
    <span v-if="timeLabel" class="time-label">{{ timeLabel }}</span>
    </div>

    <ThinkingBlock
      v-if="props.message.thinkingBody"
      :text="props.message.thinkingBody"
      class="thinking"
    />

    <MarkdownText v-if="isAssistant" :source="displayBody" />
    <!-- A report renders as a COMPACT incoming box: teaser + the door to the
         full report (the shared review dialog) — never the full body inline. -->
    <template v-else-if="isInboundReport">
      <p v-if="reportTeaser" class="report-teaser">{{ reportTeaser }}</p>
      <button
        type="button"
        class="report-open-chip"
        @click="
          emit('openReport', {
            sourceLabel: props.message.sourceLabel!,
            body: displayBody,
            kind: isInboundUpdate ? 'update' : 'report',
          })
        "
      >
        <span>{{ isInboundUpdate ? "View update" : "View report" }}</span>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </template>
    <p v-else-if="props.message.body" class="plain-body">
      {{ props.message.body }}
    </p>

    <AttachmentChips
      v-if="props.message.attachedImagesMetadata?.length"
      :attachments="props.message.attachedImagesMetadata"
    />

    <button
      v-if="linkedSessionId && props.showWatchChip"
      type="button"
      class="session-link"
      @click="emit('openSession', linkedSessionId)"
    >
      <PresenceDot :state="props.linkedSessionLive ? 'live' : 'idle'" />
      <span class="session-link-label">{{ watchChipLabel }}</span>
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
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-3);
  font: 600 10.5px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.role-user .role-label {
  color: var(--ink-2);
}

.row-header {
  display: flex;
  /* Center, not baseline: the author line leads with the avatar chip, whose
     flex "baseline" is its bottom edge — baseline-aligning would sink the
     time label below the name. */
  align-items: center;
  gap: 8px;
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

/* A persona monogram chip — the inline accent tint replaces the Claude coral
   (inline style wins over the class default). */
.monogram-text {
  color: var(--ink-1);
  font: 600 9px/1 var(--font-ui);
  letter-spacing: 0.02em;
}

.time-label {
  color: var(--ink-3);
  font: 400 10px/1.5 var(--font-ui);
  letter-spacing: 0.02em;
  opacity: 0.85;
}

/* "via Voice" — a quiet provenance mark beside the author line. */
.origin-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  border: 1px solid var(--hair);
  border-radius: 99px;
  color: var(--ink-3);
  font: 500 9.5px/1.7 var(--font-ui);
  letter-spacing: 0.04em;
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

/* An inbound report sheds the "your message" bubble — the user did not write
   it. The accent bar (always present: a report always names its workspace)
   and the persona author line carry its identity instead. */
.role-user.is-report {
  background: none;
  border: none;
  border-radius: 0;
  padding: 0 0 0 14px;
}

.role-user.is-report .role-label {
  color: var(--ink-3);
}

/* The compact incoming-report box: one teaser line, ellipsized. */
.report-teaser {
  margin: 0;
  color: var(--ink-2);
  font: 400 13px/1.6 var(--font-ui);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 640px;
}

/* The door to the full report — the workspace accent frames it (a report
   always carries its workspace's accent). */
.report-open-chip {
  appearance: none;
  border: 1px solid color-mix(in srgb, var(--accent, var(--gold)) 38%, transparent);
  margin: 0;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--accent, var(--gold)) 12%, transparent);
  color: var(--ink-1);
  font: 600 11.5px/1.5 var(--font-ui);
  cursor: default;
  transition: border-color var(--t-fast) var(--ease-out);
}

.report-open-chip:hover {
  border-color: var(--accent, var(--gold));
}

.report-open-chip:focus-visible {
  outline: 2px solid var(--accent, var(--gold));
  outline-offset: 1px;
}

.report-open-chip svg {
  color: var(--ink-3);
  flex: none;
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
  flex: none;
}

/* Task labels can run long — the chip stays one line and ellipsizes. */
.session-link-label {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
