<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import {
  isDirectMessageBody,
  isUpdateMessageBody,
  stripReportMessageMarker,
} from "@vynel/contracts/chat/report-message-marker";
import { deriveMessageOrigin } from "@vynel/contracts/chat/message-origin";
import MarkdownText from "./MarkdownText.vue";
import ThinkingBlock from "./ThinkingBlock.vue";
import AttachmentChips from "./AttachmentChips.vue";
import ClaudeMark from "./ClaudeMark.vue";
import { workspaceAccentVar } from "../lib/workspace-color.js";
import { formatMessageTimestamp } from "../lib/format-timestamp.js";

// Watch chips retired with the live-tracking redesign: tracking is a POINTER
// under the hand-off row (ThreadStream renders it); a settled row carries
// only its author identity, accent, and content.
const props = withDefaults(
  defineProps<{
    message: ChatMessageResponse;
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
    assistantName: "Assistant",
    assistantIconUrl: null,
    showHeader: true,
    authorPersona: null,
  },
);


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
    // A routed task's anchor row: Claude relayed the ask (redesign Q1). The
    // origin scope renders only when the stamp CARRIES one — an unlabeled
    // legacy stamp stays scope-silent rather than claiming "from Global" for
    // a workspace-origin dispatch.
    if (props.message.sourceKind === "global-root")
      return props.message.sourceLabel
        ? `Claude · from ${props.message.sourceLabel}`
        : "Claude";
    if (isInboundReport.value) return props.message.sourceLabel!;
    // A mention lands as the USER speaking directly into this conversation,
    // labeled with where it came from (redesign Case 3).
    if (props.message.sourceKind === "user" && props.message.sourceLabel)
      return `You · from ${props.message.sourceLabel}`;
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

// A DIRECT message (kind `direct_to_user`) — the sender speaking TO the user,
// not reporting to its requester; the badge says so.
const isInboundDirect = computed(
  () => isInboundReport.value && isDirectMessageBody(props.message.body),
);

// EVERY delivered message renders as a tool-card-style collapsible (Chad,
// 2026-08-09, his mock — reports first, then "same to message and update"):
// a kind ICON + the lead line as the TITLE, chevron at the line's end, the
// body expanding in place below. The header badges retire — the icon carries
// the kind. A body whose remainder is small renders whole as the title line
// (no pointless chevron on a two-line update).
const FOLD_REMAINDER_MIN = 120;
const inboundCardParts = computed(() => {
  if (!isInboundReport.value) return null;
  const body = displayBody.value;
  const splitAt = body.indexOf("\n\n");
  if (splitAt === -1) return { title: body, remainder: null };
  const remainder = body.slice(splitAt + 2);
  if (remainder.trim().length < FOLD_REMAINDER_MIN) return { title: body, remainder: null };
  return { title: body.slice(0, splitAt), remainder };
});

// The title line reads as plain text — markdown control chars stripped, the
// same cleanup the old teaser used.
const inboundCardTitle = computed(() =>
  inboundCardParts.value === null
    ? null
    : inboundCardParts.value.title.replace(/[#*_`>]/g, "").trim(),
);

const inboundKindWord = computed(() =>
  isInboundUpdate.value ? "update" : isInboundDirect.value ? "message" : "report",
);

const isExpanded = ref(false);

// A persona speaking as an ASSISTANT row wears its workspace accent (left
// bar). An INBOUND delivered row does NOT (Chad, 2026-08-09): a colleague
// responding in the chat is a regular participant — the persona author line
// and the quiet badge carry its identity, never special chrome.
const accentVar = computed(() => {
  const { role, sourceKind, sourceLabel } = props.message;
  const isWorkspaceVoice =
    role === "assistant" &&
    (sourceKind === "workspace-manager" || sourceKind === "agent") &&
    !!sourceLabel;
  return isWorkspaceVoice ? workspaceAccentVar(sourceLabel!) : null;
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
    </p>
    <span v-if="timeLabel" class="time-label">{{ timeLabel }}</span>
    </div>

    <ThinkingBlock
      v-if="props.message.thinkingBody"
      :text="props.message.thinkingBody"
      class="thinking"
    />

    <!-- A delivered colleague message renders as a REGULAR participant
         message (Chad, 2026-08-09 — the compact teaser + View door retired):
         full markdown body, author line + quiet badge as its identity. A
         LONG one collapses to its lead paragraph behind an in-place
         expander — never a popup. -->
    <MarkdownText v-if="isAssistant" :source="displayBody" />
    <!-- The delivered-message card (all kinds): kind icon + title line,
         chevron at the line's end, body expands in place. -->
    <template v-else-if="isInboundReport && inboundCardParts !== null">
      <button
        type="button"
        class="inbound-card"
        :class="{ 'is-expandable': inboundCardParts.remainder !== null }"
        :data-kind="inboundKindWord"
        :aria-expanded="isExpanded"
        :disabled="inboundCardParts.remainder === null"
        @click="isExpanded = !isExpanded"
      >
        <!-- UPDATE: a small clock — interim, still running. -->
        <svg
          v-if="isInboundUpdate"
          class="inbound-card-icon"
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.3" />
          <path
            d="M8 4.75V8l2.25 1.5"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <!-- MESSAGE: a speech bubble — the sender talking to the user. -->
        <svg
          v-else-if="isInboundDirect"
          class="inbound-card-icon"
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2.5 4.25c0-.97.78-1.75 1.75-1.75h7.5c.97 0 1.75.78 1.75 1.75v4.5c0 .97-.78 1.75-1.75 1.75H8.5L5 13.25V10.5h-.75c-.97 0-1.75-.78-1.75-1.75z"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
        </svg>
        <!-- REPORT: a document — the finished result. -->
        <svg
          v-else
          class="inbound-card-icon"
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 1.5h5.5L13 5v9.5H4z"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
          <path d="M9.5 1.5V5H13" stroke="currentColor" stroke-width="1.3" />
          <path
            d="M6 8.5h4M6 11h4"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
          />
        </svg>
        <span class="inbound-card-title">{{ inboundCardTitle }}</span>
        <svg
          v-if="inboundCardParts.remainder !== null"
          class="expand-chevron"
          :class="{ 'is-open': isExpanded }"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <MarkdownText
        v-if="isExpanded && inboundCardParts.remainder !== null"
        class="inbound-card-body"
        :source="inboundCardParts.remainder"
      />
    </template>
    <p v-else-if="props.message.body" class="plain-body">
      {{ props.message.body }}
    </p>

    <AttachmentChips
      v-if="props.message.attachedImagesMetadata?.length"
      :attachments="props.message.attachedImagesMetadata"
    />

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

/* An inbound colleague message sheds the "your message" bubble — the user did
   not write it. Otherwise it renders as a regular participant message: the
   persona author line + quiet badge carry its identity, no special chrome. */
.role-user.is-report {
  background: none;
  border: none;
  border-radius: 0;
  padding: 0;
}

.role-user.is-report .role-label {
  color: var(--ink-3);
}

/* The delivered-message card — the tool-card treatment: kind icon + the lead
   line as title, the chevron flowing INLINE right after the last word (the
   whole line is the toggle), the body unfolding below. Inline display keeps
   the chevron at the text's end even when the title wraps. */
.inbound-card {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 0;
  max-width: 100%;
  display: inline;
  text-align: left;
  background: transparent;
  color: var(--ink-1);
  font: 400 13.5px/1.65 var(--font-ui);
  overflow-wrap: break-word;
}

.inbound-card.is-expandable {
  cursor: pointer;
}

.inbound-card.is-expandable:hover .inbound-card-title {
  color: var(--ink-2);
}

.inbound-card:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
  border-radius: var(--radius-s);
}

.inbound-card-icon {
  color: var(--ink-3);
  vertical-align: -2px;
  margin-right: 6px;
}

.inbound-card .expand-chevron {
  color: var(--ink-3);
  vertical-align: -2px;
  margin-left: 5px;
}

/* The unfolded body breathes and sits under the TITLE text, not the icon —
   the tool-group inset idiom: a quiet hairline down the icon column. */
.inbound-card-body {
  margin: 8px 0 2px 5px;
  padding-left: 14px;
  border-left: 1px solid var(--hair);
}

.expand-chevron {
  transition: transform 140ms ease;
}

.expand-chevron.is-open {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .expand-chevron {
    transition: none;
  }
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
