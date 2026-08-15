<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatMessageResponse } from "@vynel/contracts/chat/chat-http";
import {
  isDirectMessageBody,
  isUpdateMessageBody,
  stripReportMessageMarker,
} from "@vynel/contracts/chat/report-message-marker";
import { stripTurnReferenceLine } from "@vynel/contracts/chat/turn-reference";
import { deriveMessageOrigin } from "@vynel/contracts/chat/message-origin";
import MarkdownText from "./MarkdownText.vue";
import ThinkingBlock from "./ThinkingBlock.vue";
import AttachmentChips from "./AttachmentChips.vue";
import ClaudeMark from "./ClaudeMark.vue";
import RunStatsDoor from "./RunStatsDoor.vue";
import Tooltip from "./Tooltip.vue";
import {
  formatMessageTime,
  formatMessageTimestamp,
} from "../lib/format-timestamp.js";
import { splitSourceLabel } from "../lib/source-label.js";

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
    /** The row's SCOPE identity chip: a persona row wears its workspace, a
     *  relayed/mention row its ORIGIN scope. The host resolves the label to
     *  an icon/monogram + accent — the chip's hover shows a small profile
     *  card, and the author line drops the scope text (the chip carries it).
     *  `isGlobal` swaps the image/monogram for the house glyph (the Global
     *  scope has no workspace identity). Null hides the chip. */
    workspaceBadge?: {
      name: string;
      imageUrl: string | null;
      monogram: string;
      accentVar: string;
      isGlobal?: boolean;
    } | null;
    /** The producing run's stats for the info door when the row carries none
     *  of its own — the host aggregates the TURN (tool calls, tokens,
     *  duration) for ordinary assistant turns. Served `message.runStats`
     *  (delivered rows) wins over this. */
    runStats?: ChatMessageResponse["runStats"] | null;
    /** TURN folding (Chad, 2026-08-09): true on a turn's header row — the
     *  header grows the time+chevron toggle at its right edge. */
    collapsible?: boolean;
    /** Folded: only the header strip renders — author, first-line preview,
     *  time, chevron. The body, attachments, and tool calls stay hidden. */
    collapsed?: boolean;
    /** The strip's preview when THIS row's body is empty (a turn that opens
     *  with tool calls): the host, which sees the whole turn, hands the first
     *  meaningful line — a later row's text or a tool summary. */
    previewFallback?: string | null;
    /** This turn is MARKED as the next message's reference (the header's chat
     *  icon) — the icon lights up so the mark is visible from the thread. */
    referenced?: boolean;
    /** The reply shows its SUMMARY only — the first paragraph, no detail. The
     *  host owns the fold (a turn folds as one, and one member cannot hide its
     *  siblings), so this row only renders what it is told. */
    replyCollapsed?: boolean;
    /** There is something behind the fold — more text, another message, or a
     *  tool call. Only then does the caret render; a control that opens
     *  nothing is worse than no control. The host sees the whole turn. */
    replyFoldable?: boolean;
  }>(),
  {
    assistantName: "Assistant",
    assistantIconUrl: null,
    showHeader: true,
    authorPersona: null,
    workspaceBadge: null,
    runStats: null,
    collapsible: false,
    collapsed: false,
    previewFallback: null,
    referenced: false,
    replyCollapsed: false,
    replyFoldable: false,
  },
);

const emit = defineEmits<{
  /** The turn header's fold toggle (thread-wide turn collapsing — the host
   *  owns which turns are open; this row only reports the click). */
  toggleCollapse: [];
  /** The chat icon: mark (or unmark) this turn as what the next message
   *  refers to. The host owns the mark; this row only reports the click. */
  toggleReference: [];
  /** The reply caret: show the turn as it really ran, or fold it back to its
   *  summary. The host owns the state — a turn folds as one. */
  toggleReply: [];
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
    // A routed task's anchor row: Claude relayed the ask (redesign Q1). The
    // origin scope renders only when the stamp CARRIES one — an unlabeled
    // legacy stamp stays scope-silent rather than claiming "from Global" for
    // a workspace-origin dispatch. With an origin chip beside the name, the
    // "from X" text moves into the chip + its hover card.
    if (props.message.sourceKind === "global-root") {
      if (!props.message.sourceLabel) return "Claude";
      return props.workspaceBadge !== null
        ? "Claude"
        : `Claude · from ${props.message.sourceLabel}`;
    }
    if (isInboundReport.value) {
      // With a workspace chip beside the name, the label shows the PERSONA
      // part only — the workspace moved into the chip + its hover card.
      return props.workspaceBadge !== null
        ? splitSourceLabel(props.message.sourceLabel!).persona
        : props.message.sourceLabel!;
    }
    // A mention lands as the USER speaking directly into this conversation,
    // labeled with where it came from (redesign Case 3).
    if (props.message.sourceKind === "user" && props.message.sourceLabel)
      return props.workspaceBadge !== null
        ? "You"
        : `You · from ${props.message.sourceLabel}`;
    return "You";
  }
  if (props.message.sourceKind === "global-root") return "Claude";
  if (
    (props.message.sourceKind === "workspace-manager" ||
      props.message.sourceKind === "agent") &&
    props.message.sourceLabel
  ) {
    // Same rule as the inbound branch: with a workspace chip beside the
    // name, the label keeps only the persona part — a persona speaking in
    // its own room reads exactly like its delivered rows elsewhere.
    return props.workspaceBadge !== null
      ? splitSourceLabel(props.message.sourceLabel).persona
      : props.message.sourceLabel;
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
// underneath. A plain user line wears a person icon: the canvas puts the
// author's PHOTO here, and we have no avatar to serve, so the slot is filled
// with a glyph rather than left empty (the author line reads as a header
// only when both speakers have a face).
type AuthorGlyph =
  | { kind: "image"; imageUrl: string }
  | { kind: "monogram"; monogram: string; accentVar: string }
  | { kind: "claude" }
  | { kind: "user" }
  | null;

const authorGlyph = computed<AuthorGlyph>(() => {
  if (props.message.role === "user" && !isInboundReport.value)
    return { kind: "user" };
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
// conversation reads as a timeline, not an undated wall. A REPLY shows the
// clock alone: it sits under an ask whose header already dated the exchange,
// and the canvas drops the day there for exactly that reason.
const timeLabel = computed(() =>
  isAssistant.value
    ? formatMessageTime(props.message.createdAt)
    : formatMessageTimestamp(props.message.createdAt),
);

// Both first-line markers are written FOR THE MODEL and stripped for display:
// a delivered report's attribution (the notify turn must never mistake it for
// user input — the author line already names the reporter), and an ask's turn
// reference (the person already saw what they marked). Left in, the reference
// became the folded card's preview and ate the question itself.
const displayBody = computed(() =>
  isInboundReport.value
    ? stripReportMessageMarker(props.message.body)
    : stripTurnReferenceLine(props.message.body),
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
  if (remainder.trim().length < FOLD_REMAINDER_MIN)
    return { title: body, remainder: null };
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
  isInboundUpdate.value
    ? "update"
    : isInboundDirect.value
      ? "message"
      : "report",
);

const isExpanded = ref(false);

// The run-stats hover card (Chad, 2026-08-09): the info icon reveals the
// PRODUCING run's stats. Served stats (delivered rows — the colleague's run)
// win over the host's TURN aggregate (every other assistant turn) so one door
// serves both.
const runStats = computed(() => props.message.runStats ?? props.runStats);

// THE REPLY (Kafi, 2026-08-15 — ONE rule for every chat, the one the
// delivered-report card already follows): the first paragraph is the summary,
// everything else is detail. No length floor here — the host folds the whole
// TURN, so tool calls and later messages sit behind the caret too and there
// is essentially always something to open.
const assistantLeadParts = computed(() => {
  if (!isAssistant.value || displayBody.value.trim() === "") return null;
  const body = displayBody.value;
  const splitAt = body.indexOf("\n\n");
  if (splitAt === -1) return { lead: body, detail: null };
  return { lead: body.slice(0, splitAt), detail: body.slice(splitAt + 2) };
});

// The whole lead line toggles the fold, but a drag-select ends in a click and
// would swallow the answer the moment you tried to copy from it. A live
// selection means the person is reading, not folding.
function onLeadClick(event: MouseEvent) {
  if (!props.replyFoldable) return;
  if ((event.target as HTMLElement | null)?.closest("a")) return;
  if (window.getSelection()?.isCollapsed === false) return;
  emit("toggleReply");
}

// The ask wears its time INLINE beside the name (the canvas's card header);
// every other row keeps it on the right, where the reply's caret joins it.
const showsInlineTime = computed(
  () => props.message.role === "user" && !isInboundReport.value,
);

// The canvas reaches its chat icon from both ends of a card — the header's
// top-right cluster and the reply's own line. Each row marks ITSELF, so
// pointing at the ask and pointing at the answer stay different things.
const showsReferenceToggle = computed(
  () => props.collapsible || (isAssistant.value && props.showHeader),
);

// The folded strip's one-line preview — the first non-empty line of the
// display body (marker already stripped), the card-title cleanup applied.
// A body-less header row (a turn opening with tool calls) shows the host's
// fallback — the turn's first meaningful line — instead of an empty strip.
const collapsedPreview = computed(() => {
  if (!props.collapsed) return null;
  const firstLine =
    displayBody.value.split("\n").find((line) => line.trim() !== "") ??
    props.previewFallback ??
    "";
  return firstLine.replace(/[#*_`>]/g, "").trim();
});
</script>

<template>
  <div
    class="message-row"
    :class="[`role-${props.message.role}`, { 'is-report': isInboundReport }]"
  >
    <div
      v-if="props.showHeader"
      class="row-header"
      :class="{ 'is-collapsible': props.collapsible }"
      @click="props.collapsible ? emit('toggleCollapse') : undefined"
    >
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
          <span
            v-else-if="authorGlyph.kind === 'monogram'"
            class="monogram-text"
            >{{ authorGlyph.monogram }}</span
          >
          <svg
            v-else-if="authorGlyph.kind === 'user'"
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="8" cy="5.5" r="2.6" stroke="currentColor" stroke-width="1.4" />
            <path
              d="M2.9 14a5.1 5.1 0 0 1 10.2 0"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
          <ClaudeMark v-else :size="14" />
        </span>
        {{ roleLabel }}
        <!-- The SCOPE chip (Chad, 2026-08-09): the label's workspace/origin
           text became an icon; hover shows the profile card. Global wears
           the house glyph (echoing the Global tab). -->
        <Tooltip v-if="props.workspaceBadge" side="bottom" :delay-ms="150">
          <template #content>
            <span class="hover-card">
              <span
                class="hover-card-chip"
                :class="{ 'is-global': props.workspaceBadge.isGlobal }"
                :style="
                  props.workspaceBadge.isGlobal
                    ? undefined
                    : {
                        background: `color-mix(in srgb, var(${props.workspaceBadge.accentVar}) 30%, transparent)`,
                      }
                "
              >
                <svg
                  v-if="props.workspaceBadge.isGlobal"
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2.5 6.6 8 2.2l5.5 4.4V13a.8.8 0 0 1-.8.8H3.3a.8.8 0 0 1-.8-.8V6.6Z"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
                <img
                  v-else-if="props.workspaceBadge.imageUrl"
                  :src="props.workspaceBadge.imageUrl"
                  alt=""
                />
                <span v-else>{{ props.workspaceBadge.monogram }}</span>
              </span>
              <span class="hover-card-title">{{
                props.workspaceBadge.name
              }}</span>
              <span class="hover-card-caption">{{
                props.workspaceBadge.isGlobal ? "Scope" : "Workspace"
              }}</span>
            </span>
          </template>
          <span
            class="workspace-badge"
            :class="{ 'is-global': props.workspaceBadge.isGlobal }"
            :style="
              props.workspaceBadge.isGlobal
                ? undefined
                : {
                    background: `color-mix(in srgb, var(${props.workspaceBadge.accentVar}) 30%, transparent)`,
                  }
            "
            :aria-label="
              props.workspaceBadge.isGlobal
                ? 'from Global'
                : `workspace ${props.workspaceBadge.name}`
            "
          >
            <svg
              v-if="props.workspaceBadge.isGlobal"
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.5 6.6 8 2.2l5.5 4.4V13a.8.8 0 0 1-.8.8H3.3a.8.8 0 0 1-.8-.8V6.6Z"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
              />
            </svg>
            <img
              v-else-if="props.workspaceBadge.imageUrl"
              :src="props.workspaceBadge.imageUrl"
              alt=""
            />
            <span v-else class="badge-monogram">{{
              props.workspaceBadge.monogram
            }}</span>
          </span>
        </Tooltip>
        <!-- The run-stats door. A reply carries it at the head of its lead
             line (where the canvas draws the glyph); rows with no lead — an
             ask, a delivered report — keep it here beside the author. -->
        <RunStatsDoor
          v-if="runStats && !assistantLeadParts"
          :stats="runStats"
          :served="props.message.runStats != null"
        />
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
      <!-- The canvas's card header reads "name | time" — one hairline, then
           the timestamp, inline. Only the ask wears it this way, and it sits
           BESIDE the label: `.role-label` names the author, nothing else. -->
      <template v-if="showsInlineTime && timeLabel">
        <span class="name-divider" aria-hidden="true" />
        <span class="time-label">{{ timeLabel }}</span>
      </template>
      <span class="header-meta">
        <span v-if="timeLabel && !showsInlineTime" class="time-label is-reply">{{
          timeLabel
        }}</span>
        <button
          v-if="props.replyFoldable"
          type="button"
          class="reply-caret"
          :aria-expanded="!props.replyCollapsed"
          aria-label="show or hide this turn as it ran"
          @click.stop="emit('toggleReply')"
        >
          <svg
            class="collapse-chevron"
            :class="{ 'is-open': !props.replyCollapsed }"
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <!-- Mark this turn as what the next message is about. The canvas puts
             a reply box behind this icon; Kafi's call is a MARK instead — no
             per-card composer, just a pointer the next send carries. -->
        <button
          v-if="showsReferenceToggle"
          type="button"
          class="reference-toggle"
          :class="{ 'is-marked': props.referenced }"
          :aria-pressed="props.referenced"
          :title="
            props.referenced
              ? 'Marked — your next message refers to this'
              : 'Mark this for your next message'
          "
          aria-label="mark this turn as the next message's reference"
          @click.stop="emit('toggleReference')"
        >
          <!-- 13px heading a card, 12px on a reply line — the canvas's two sizes. -->
          <svg
            :width="props.collapsible ? 13 : 12"
            :height="props.collapsible ? 13 : 12"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path
              d="M13.5 8a5.5 5.5 0 0 1-5.5 5.5H2.5V8a5.5 5.5 0 0 1 11 0Z"
              :fill="props.referenced ? 'currentColor' : 'none'"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <!-- The canvas's card control: arrows out to open the folded card,
             arrows in to close it — not a chevron. -->
        <button
          v-if="props.collapsible"
          type="button"
          class="collapse-toggle"
          :aria-expanded="!props.collapsed"
          :title="props.collapsed ? 'Expand' : 'Collapse'"
          aria-label="fold or unfold this message"
          @click.stop="emit('toggleCollapse')"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <template v-if="props.collapsed">
              <path d="M9.5 2.5h4v4" />
              <path d="M13.5 2.5 9 7" />
              <path d="M6.5 13.5h-4v-4" />
              <path d="M2.5 13.5 7 9" />
            </template>
            <template v-else>
              <path d="M13.5 6.5h-4v-4" />
              <path d="M9.5 6.5 14 2" />
              <path d="M2.5 9.5h4v4" />
              <path d="M6.5 9.5 2 14" />
            </template>
          </svg>
        </button>
      </span>
    </div>

    <!-- Folded: the canvas's collapsed card — the header line above, then
         the ask's first line + "read more" on their own line. -->
    <div
      v-if="props.collapsed && collapsedPreview"
      class="collapsed-line"
      @click="props.collapsible ? emit('toggleCollapse') : undefined"
    >
      <span class="turn-preview">{{ collapsedPreview }}</span>
      <span class="read-more">read more</span>
    </div>

    <template v-if="!props.collapsed">
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
      <!-- The reply: its lead line beside the info glyph, the rest folded
           behind the header's caret (the canvas's reply block). -->
      <template v-if="assistantLeadParts">
        <div
          class="reply-lead"
          :class="{ 'is-foldable': props.replyFoldable }"
          @click="onLeadClick"
        >
          <!-- The glyph sits on the lead's first line; a flex baseline would
               sink an SVG to its box bottom, so the slot nudges it optically. -->
          <span class="lead-glyph-slot">
            <RunStatsDoor
              :stats="runStats"
              :served="props.message.runStats != null"
            />
          </span>
          <MarkdownText
            class="reply-lead-text"
            variant="reply"
            :source="assistantLeadParts.lead"
          />
        </div>
        <MarkdownText
          v-if="!props.replyCollapsed && assistantLeadParts.detail"
          class="reply-detail"
          variant="reply"
          :source="assistantLeadParts.detail"
        />
      </template>
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
            <circle
              cx="8"
              cy="8"
              r="6.25"
              stroke="currentColor"
              stroke-width="1.3"
            />
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
      <!-- An ask stays literal — no markdown — but its mentions still chip.
           The renderer's `plain` variant does exactly that, so the chip lives
           in one place instead of a second copy of the rule here. -->
      <MarkdownText
        v-else-if="props.message.body"
        class="plain-body"
        variant="plain"
        :source="displayBody"
      />

      <AttachmentChips
        v-if="props.message.attachedImagesMetadata?.length"
        :attachments="props.message.attachedImagesMetadata"
      />

      <p v-if="props.message.errorMessage" class="error-note">
        {{ props.message.errorMessage }}
      </p>

      <slot name="tool-calls" />
    </template>
  </div>
</template>

<style scoped>
.message-row {
  display: grid;
  gap: 6px;
}

.role-label {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--color-neutral-400);
  /* The canvas's reply author line: small caps, wide tracking, weight 400 —
     the tracking carries it, not the weight. */
  font: 400 10px/1.5 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

/* The ASK's author (the canvas's card header): plain 12px semibold — the
   human's name is a name, not a label. Delivered reports keep the label
   treatment (they speak as a persona). */
.role-user:not(.is-report) .role-label {
  color: var(--ink-2);
  /* Line-height 1, the canvas's: the name and the time beside it are set on
     the same tight box so they read as one line, not two stacked ones. */
  font: 600 12px/1 var(--font-ui);
  text-transform: none;
  letter-spacing: 0;
}

.row-header {
  display: flex;
  /* Center, not baseline: the author line leads with the avatar chip, whose
     flex "baseline" is its bottom edge — baseline-aligning would sink the
     time label below the name. */
  align-items: center;
  /* The canvas's author row spaces its parts at 7px, the same step the label
     uses inside itself — one rhythm across the whole line. */
  gap: 7px;
}

/* TURN folding: a collapsible header is the whole toggle; its time + chevron
   cluster rides the RIGHT edge (Chad's mock). Non-collapsible headers keep
   the meta inline after the name — nothing moves for them. */
.row-header.is-collapsible {
  cursor: pointer;
  /* The nowrap preview must never dictate the row's width: as a grid item
     the header's automatic minimum is its content's min-content, which a
     long one-line preview inflates past the column (the horizontal-scrollbar
     bug) — zero the minimum and clip. */
  min-width: 0;
  overflow: hidden;
}

.row-header .role-label {
  flex: none;
}

.header-meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
}

.row-header.is-collapsible .header-meta {
  margin-left: auto;
  /* ONE vertical line for every chevron (Chad's ruler) — with the user
     bubble retired (Arc 5b), every row's toggle lands at the card edge. */
  margin-right: 0;
}

/* The folded card's second line — the canvas's collapsed ask (14px medium,
   ellipsized) with the quiet "read more" beside it. */
.collapsed-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  cursor: pointer;
}

.turn-preview {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-2);
  font: 500 14px/1.35 var(--font-ui);
}

/* The canvas's "read more" affordance beside the folded strip's preview —
   the whole header is the toggle; this names it. */
.read-more {
  flex: none;
  color: var(--ink-3);
  font: 400 11.5px/1.5 var(--font-ui);
  transition: color var(--t-fast, 120ms) ease;
}

.row-header.is-collapsible:hover .read-more {
  color: var(--gold);
}

.collapse-toggle,
.reference-toggle {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 2px;
  display: inline-flex;
  background: transparent;
  /* The canvas's card controls sit a step brighter than the meta text they
     stand beside — they are the things you reach for. */
  color: var(--color-neutral-500);
  cursor: pointer;
  border-radius: var(--radius-s);
  transition: color var(--t-fast, 120ms) ease;
}

.collapse-toggle:hover,
.reference-toggle:hover {
  color: var(--ink-1);
}

.collapse-toggle:focus-visible,
.reference-toggle:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

/* A marked turn wears the accent — the same light the composer's chip uses,
   so the pointer reads as one thing from both ends. */
.reference-toggle.is-marked,
.reference-toggle.is-marked:hover {
  color: var(--gold);
}

.collapse-chevron {
  transition: transform 140ms ease;
}

.collapse-chevron.is-open {
  transform: rotate(180deg);
}

/* A reply line ends with its time and fold caret at the row's right edge —
   the canvas's `margin-left: auto` cluster. Only the ask keeps its meta
   tight against the name (its time went inline). */
.row-header:not(.is-collapsible) .header-meta {
  margin-left: auto;
}

.reply-caret {
  appearance: none;
  border: 0;
  margin: 0;
  padding: 2px;
  display: inline-flex;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  border-radius: var(--radius-s);
}

.reply-caret:hover {
  color: var(--ink-1);
}

.reply-caret:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

/* THE REPLY: the info glyph and the one line that answers. */
.reply-lead {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  min-width: 0;
}

.reply-lead.is-foldable {
  cursor: pointer;
}

.lead-glyph-slot {
  display: inline-flex;
  flex: none;
  margin-top: 3px;
}

/* The lead is set TIGHTER than the detail under it (the canvas: 1.4 against
   1.5). It asks through the variant's own hook rather than re-declaring
   `font` — a competing shorthand here lands at the same specificity as
   MarkdownText's, so which one won came down to stylesheet order. */
.reply-lead .reply-lead-text {
  --reply-leading: 1.4;

  flex: 1 1 auto;
  min-width: 0;
  color: var(--color-neutral-200);
  text-wrap: pretty;
}

/* The rest of the answer, once the caret opens it — a step quieter than the
   lead. The canvas sets its blocks 8px in from the glyph COLUMN, not under the
   lead's text: the detail is the reply's own body, not a continuation of the
   first line. */
.message-row .reply-detail {
  padding-left: 8px;
  color: var(--color-neutral-300);
  font: 400 12.5px/1.5 var(--font-ui);
}


.author-avatar {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
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

/* The human's chip stays neutral — the coral tint above is Claude's identity
   and must not read as the user's. */
.role-user:not(.is-report) .author-avatar {
  background: var(--color-neutral-900);
  color: var(--color-neutral-400);
}

/* A persona monogram chip — the inline accent tint replaces the Claude coral
   (inline style wins over the class default). */
.monogram-text {
  color: var(--ink-1);
  font: 600 9px/1 var(--font-ui);
  letter-spacing: 0.02em;
}

.time-label {
  color: var(--ink-2);
  font: 400 11px/1 var(--font-ui);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* On the right of a reply row the time is quieter and a half-step smaller —
   it labels the fold, it doesn't head the card. */
.time-label.is-reply {
  color: var(--ink-3);
  font-size: 10.5px;
}

/* The hairline between the author's name and the time. */
.name-divider {
  width: 1px;
  height: 10px;
  flex: none;
  background: color-mix(in srgb, var(--color-text) 16%, transparent);
}

/* The workspace identity chip beside the author name — the label's workspace
   text as an icon (accent-tinted monogram, or the customized image). */
.workspace-badge {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 6px;
  overflow: hidden;
}

/* Global has no workspace accent — a quiet neutral chip; the glyph carries
   the meaning (gold stays reserved for assistant presence). */
.workspace-badge.is-global,
.hover-card-chip.is-global {
  background: var(--row-hover);
  color: var(--ink-2);
}

.workspace-badge img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.badge-monogram {
  color: var(--ink-1);
  font: 600 8px/1 var(--font-ui);
  letter-spacing: 0.02em;
}

/* Hover-card content (teleported, but it keeps this component's scope). */
.hover-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 3px 4px;
}

.hover-card-chip {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  overflow: hidden;
  color: var(--ink-1);
  font: 600 11px/1 var(--font-ui);
}

.hover-card-chip img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hover-card-title {
  color: var(--ink-1);
  font: 600 12px/1.4 var(--font-ui);
}

.hover-card-caption {
  color: var(--ink-3);
  font: 500 9.5px/1.2 var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
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

/* Scoped through `.message-row` deliberately: the renderer's own root font
   lands on this same element at equal specificity, and a tie is settled by
   stylesheet order. */
.message-row .plain-body {
  margin: 0;
  color: var(--ink-1);
  font: 400 13.5px/1.65 var(--font-ui);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

/* The ask reads as the CARD's own voice (workspace redesign Arc 5b — the
   conversation card is the container, so the old "your message" bubble
   retired): plain lines at the canvas's 14px/500. */
.message-row.role-user:not(.is-report) .plain-body {
  font: 500 14px/1.35 var(--font-ui);
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
