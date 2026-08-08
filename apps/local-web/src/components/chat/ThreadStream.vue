<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type {
  ChatMessageResponse,
  ChatToolCallResponse,
} from "@vynel/contracts/chat/chat-http";
import { stripReportMessageMarker } from "@vynel/contracts/chat/report-message-marker";
import {
  MessageRow,
  ToolCallList,
  presentToolCall,
  splitSourceLabel,
  workspaceColorSlot,
  workspaceMonogram,
} from "@vynel/ui";
import { useCustomizeStore } from "../../stores/customize-store.js";
import type { ActiveTurnView } from "../../composables/chat/active-turn-view.js";
import LiveTurn from "./LiveTurn.vue";
import PointerRow from "./PointerRow.vue";
import { buildToolCallPointer } from "./thread-pointers.js";
import type { ThreadPointerModel } from "./thread-pointers.js";
import { usePersonaResolver } from "../../composables/personas/resolve-persona.js";

// Watch chips follow the PIPELINE scoping rule (Chad, 2026-07-21 evening —
// Global → Workspace → Session → Agent): a thread shows chips ONLY for its
// DIRECT children's activity, never for the delegation that targeted itself
// (that one is its PARENT's watch — the Slice-④ everywhere-parity leaked it
// onto every level). Agent chips are exempt: an agent is always the row's own
// direct child.
const props = withDefaults(
  defineProps<{
    messages: ChatMessageResponse[];
    toolCallsByMessageId: Record<string, ChatToolCallResponse[]>;
    activeTurn: ActiveTurnView | null;
    /** Who speaks for plain assistant rows on this surface (settled AND live) —
     *  the global thread passes the assistant's name. */
    assistantName?: string;
    /** The persona's custom conversation icon; null = the Claude mark. */
    assistantIconUrl?: string | null;
    /** The thread pointers by trace key (live-tracking redesign, Case 1): a
     *  compact "task → target" line renders under the FIRST visible row
     *  carrying an in-flight trace key this thread SENT — the pointer is the
     *  whole tracker, and it vanishes when the task settles. */
    pointersByTraceId?: Map<string, ThreadPointerModel> | undefined;
    /** The pointer's landing (redesign Case 1): scroll to the row carrying
     *  this trace key on open, flash it, and stay there — the user asked for
     *  where the task started, not the live edge. */
    scrollToTraceId?: string | undefined;
    /** Workspace name → id (the host's list) — unlocks the delivered-row
     *  workspace chip's customized icon + accent. Omitted = name-derived look. */
    workspacesByName?: Record<string, string> | undefined;
  }>(),
  {
    assistantName: "Assistant",
    assistantIconUrl: null,
    pointersByTraceId: undefined,
    scrollToTraceId: undefined,
    workspacesByName: undefined,
  },
);

const emit = defineEmits<{
  decideApproval: [approvalRequestId: string, decision: "approved" | "denied"];
  /** A thread pointer's click — navigate to where the task started (the
   *  `partialSessionId` anchor; the redesign's tracking mechanic). The host
   *  routes by the pointer's target (session segment / workspace). */
  openPointer: [pointer: ThreadPointerModel];
}>();

// A persona-attributed row (a manager's reply, a colleague's report/update)
// wears ITS OWN face in the author line (B8) — resolved from the label the
// same way the live cards resolve theirs, with the host's name→id map keying
// the workspace's customized persona image.
const { resolvePersona } = usePersonaResolver();

// The workspace chip beside a persona row's author (Chad, 2026-08-09): the
// label's LAST " · " segment (the persona-first rule) resolves to an
// icon/monogram + accent; hover shows the profile card. The host's name→id
// map unlocks the customized image + color. EVERY persona-stamped row wears
// it — the delivered colleague row in Global and the persona's own reply in
// its workspace read as the same participant (2026-08-09 parity pass).
const customize = useCustomizeStore();
function workspaceBadgeFor(message: ChatMessageResponse) {
  if (
    (message.sourceKind !== "agent" &&
      message.sourceKind !== "workspace-manager") ||
    message.sourceLabel == null
  ) {
    return null;
  }
  const { workspace } = splitSourceLabel(message.sourceLabel);
  if (workspace === null) return null;
  const workspaceId = props.workspacesByName?.[workspace] ?? null;
  const custom =
    workspaceId !== null ? customize.customizationFor(workspaceId) : null;
  return {
    name: workspace,
    imageUrl: custom?.workspaceImage ?? null,
    monogram: workspaceMonogram(workspace),
    accentVar: `--ws-${custom?.colorSlot ?? workspaceColorSlot(workspace)}`,
  };
}

function authorPersonaFor(message: ChatMessageResponse) {
  const isPersonaRow =
    (message.sourceKind === "workspace-manager" ||
      message.sourceKind === "agent") &&
    message.sourceLabel != null;
  if (!isPersonaRow) return null;
  // The label's workspace segment keys the host map — a resolved id unlocks
  // the workspace's customized persona image, the same face the live cards
  // and the surface's own assistant rows wear.
  const { workspace } = splitSourceLabel(message.sourceLabel!);
  const workspaceId =
    workspace !== null ? (props.workspacesByName?.[workspace] ?? null) : null;
  return resolvePersona({ name: message.sourceLabel!, workspaceId });
}

// The received-vs-sent discriminator (empirical, from how rows land): a
// delegation that TARGETED this thread persists its ATTRIBUTED inbound row
// HERE as `role:'user'` + a non-null sourceKind carrying the trace key — a
// routed task lands as 'global-root' (the shared pipeline's
// messageAttribution — delegate-to-workspace-root / delegate-to-spawned-
// session), a report-delivery NOTIFY turn lands as 'workspace-manager'
// + the child's label (session-comms), and a MENTION lands as 'user' + the
// origin scope's label (redesign Case 3). The replies share that key. Work this
// thread SENT DOWN never leaves an attributed USER row here (its rows are
// assistant-role). So: a trace key with ANY attributed user row in this
// thread was RECEIVED → its rows show no watch chip (a delivery turn must
// never render a Watch chip pointing at the thread's own notify turn — the
// 12b90bd self-watch leak class). Computed over the FULL history, not the
// visible window — the inbound row may be scrolled out while its replies
// are on screen.
const receivedTraceIds = computed(() => {
  const ids = new Set<string>();
  for (const message of props.messages) {
    if (
      message.role === "user" &&
      message.sourceKind != null &&
      message.partialSessionId != null
    ) {
      ids.add(message.partialSessionId);
    }
  }
  return ids;
});

// The pointer renders once per trace key, under the FIRST visible
// row that CARRIES it — and only on the SENDING side (the received-trace
// discriminator above): in the target's own thread the task row is the
// anchor, not a pointer. Sender-side, the work key lives on the dispatch
// TOOL CALL's served delegation (send_message / send_task_* — message rows
// themselves are unstamped on interactive turns), so matching goes through
// toolCallsByMessageId first; the row-key path stays for target-side gating
// and the future mention-row stamp.
const pointersByMessageId = computed(() => {
  const byMessage = new Map<string, ThreadPointerModel[]>();
  const placed = new Set<string>();
  for (const message of visibleMessages.value) {
    const candidates: ThreadPointerModel[] = [];
    for (const call of props.toolCallsByMessageId[message.id] ?? []) {
      if (call.delegation == null) continue;
      // The live poll overlays first (fresher status, persona-enriched target
      // labels); the served payload is the PERSISTENT base — a settled task
      // keeps its pointer in its terminal state (Chad, 2026-08-09, revising
      // D6's in-flight-only).
      const key = call.delegation.partialSessionId;
      const live = key != null ? props.pointersByTraceId?.get(key) : undefined;
      const pointer = live ?? buildToolCallPointer(call.delegation);
      if (pointer != null) candidates.push(pointer);
    }
    // Row-key match (mention-stamped rows): live-only — a settled mention
    // leaves the colleague's reply box, which is its own record.
    if (message.partialSessionId != null) {
      const rowLive = props.pointersByTraceId?.get(message.partialSessionId);
      if (rowLive !== undefined) candidates.push(rowLive);
    }
    for (const pointer of candidates) {
      if (
        placed.has(pointer.partialSessionId) ||
        receivedTraceIds.value.has(pointer.partialSessionId)
      ) {
        continue;
      }
      const rowPointers = byMessage.get(message.id) ?? [];
      rowPointers.push(pointer);
      byMessage.set(message.id, rowPointers);
      placed.add(pointer.partialSessionId);
    }
  }
  return byMessage;
});

const scroller = ref<HTMLElement | null>(null);

// ── Discord-model scrolling ─────────────────────────────────────────────────
// The thread renders only the newest window of history (the wire returns the
// whole session; older rows reveal as you scroll up — client-side paging until
// the API grows real pagination). Growth follows the live edge ONLY while the
// reader is pinned at the bottom; scrolled-up readers keep their place and get
// a jump-to-latest pill instead of a yank.

const HISTORY_WINDOW = 100;

const visibleCount = ref(HISTORY_WINDOW);
const isPinnedToBottom = ref(true);
// True while a smooth jump-to-latest is in flight — scroll events during the
// glide must neither flicker the pill back on nor trigger a history reveal
// (which would stale the jump's target height).
const isAutoScrolling = ref(false);

// While a turn streams, its rows ALREADY persist (user message at start,
// assistant text per chunk) — so any history refetch mid-turn (the delegation
// or background-turn poll, the settle refetch racing the overlay teardown)
// would render the same message twice: once settled, once in the live
// overlay. The overlay owns its own rows; drop them from history.
const settledMessages = computed(() => {
  const turn = props.activeTurn;
  if (turn === null) return props.messages;
  const overlayIds = new Set(turn.segments.map((segment) => segment.messageId));
  if (turn.userMessage) overlayIds.add(turn.userMessage.id);
  return props.messages.filter((message) => !overlayIds.has(message.id));
});

const visibleMessages = computed(() =>
  settledMessages.value.length > visibleCount.value
    ? settledMessages.value.slice(-visibleCount.value)
    : settledMessages.value,
);

// One assistant turn persists as SEVERAL message rows (one per provider
// message — text → tool → text each get their own). The live overlay shows
// them under ONE author line; a reloaded thread must read the same, so a row
// continuing the previous row's assistant run hides its header. Same author =
// same role + same sourceKind/sourceLabel (the roleLabel inputs). The gap
// guard keeps SEPARATE turns apart: consecutive background turns (schedule
// fires, channel replies) have no user row between them, and merging them
// would also hide the later turn's timestamp.
const CONTINUATION_MAX_GAP_MS = 10 * 60 * 1000;

function startsNewTurn(
  message: ChatMessageResponse,
  previous: ChatMessageResponse | undefined,
): boolean {
  if (!previous) return true;
  const gapMs =
    new Date(message.createdAt).getTime() -
    new Date(previous.createdAt).getTime();
  return !(
    message.role === "assistant" &&
    previous.role === "assistant" &&
    message.sourceKind === previous.sourceKind &&
    message.sourceLabel === previous.sourceLabel &&
    gapMs < CONTINUATION_MAX_GAP_MS
  );
}

function showsHeaderFor(index: number): boolean {
  const message = visibleMessages.value[index];
  if (!message) return true;
  return startsNewTurn(message, visibleMessages.value[index - 1]);
}
const hiddenOlderCount = computed(() =>
  Math.max(0, settledMessages.value.length - visibleCount.value),
);

// TURN folding (Chad, 2026-08-09): every turn folds to its header strip —
// author, first-line preview, time, chevron. Only the LATEST turn is open by
// default; a manual toggle overrides its turn from then on (so an arriving
// turn folds the previous one unless the user pinned it open). A turn = a
// header row + its continuations (the showsHeaderFor grouping), keyed by its
// first row's id.
// Keys derive from the FULL settled history, not the window — revealing an
// older page must never re-key a turn cut at the window boundary (that would
// orphan a manual fold override, the Gate-3 catch).
const turnKeyByMessageId = computed(() => {
  const keys = new Map<string, string>();
  let current: string | null = null;
  settledMessages.value.forEach((message, index) => {
    if (
      current === null ||
      startsNewTurn(message, settledMessages.value[index - 1])
    ) {
      current = message.id;
    }
    keys.set(message.id, current);
  });
  return keys;
});
const latestTurnKey = computed(() => {
  const last = settledMessages.value.at(-1);
  return last === undefined
    ? null
    : (turnKeyByMessageId.value.get(last.id) ?? null);
});
const collapseOverrides = ref(new Map<string, boolean>());

function turnKeyAt(index: number): string {
  const message = visibleMessages.value[index];
  if (message === undefined) return "";
  return turnKeyByMessageId.value.get(message.id) ?? message.id;
}

function isTurnExpanded(turnKey: string): boolean {
  return (
    collapseOverrides.value.get(turnKey) ?? turnKey === latestTurnKey.value
  );
}

function toggleTurn(turnKey: string) {
  const next = new Map(collapseOverrides.value);
  next.set(turnKey, !isTurnExpanded(turnKey));
  collapseOverrides.value = next;
}

function expandTurnOf(messageId: string) {
  const key = turnKeyByMessageId.value.get(messageId);
  if (key === undefined || isTurnExpanded(key)) return;
  const next = new Map(collapseOverrides.value);
  next.set(key, true);
  collapseOverrides.value = next;
}

// The folded strip's preview when the turn's HEADER row has no text (a turn
// opening with tool calls): the first non-empty body among the turn's rows,
// else the turn's first tool call as a one-line summary ("Read CLAUDE.md") —
// an empty strip tells the user nothing about what's behind the chevron.
const turnPreviewFallbacks = computed(() => {
  const bodyLines = new Map<string, string>();
  const toolLines = new Map<string, string>();
  for (const message of settledMessages.value) {
    const turnKey = turnKeyByMessageId.value.get(message.id) ?? message.id;
    if (!bodyLines.has(turnKey)) {
      // Marker-stripped, matching the row's own displayBody — the model-facing
      // "[Report from …]" line must never surface as a strip preview.
      const firstLine = stripReportMessageMarker(message.body)
        .split("\n")
        .find((line) => line.trim() !== "");
      if (firstLine !== undefined) bodyLines.set(turnKey, firstLine);
    }
    if (!toolLines.has(turnKey)) {
      const firstCall = props.toolCallsByMessageId[message.id]?.[0];
      if (firstCall !== undefined) {
        const { verb, argument } = presentToolCall(firstCall);
        toolLines.set(
          turnKey,
          argument === null ? verb : `${verb} ${argument}`,
        );
      }
    }
  }
  return { bodyLines, toolLines };
});

function turnPreviewFallbackFor(turnKey: string): string | null {
  const { bodyLines, toolLines } = turnPreviewFallbacks.value;
  return bodyLines.get(turnKey) ?? toolLines.get(turnKey) ?? null;
}

function scrollToBottom(behavior: ScrollBehavior = "auto") {
  const element = scroller.value;
  if (!element) return;
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const resolvedBehavior = prefersReducedMotion ? "auto" : behavior;
  isAutoScrolling.value = resolvedBehavior === "smooth";
  element.scrollTo({ top: element.scrollHeight, behavior: resolvedBehavior });
  isPinnedToBottom.value = true;
}

/** Reveal an older page while keeping the viewport anchored on the same row —
 *  the prepended rows grow the scrollHeight, so offset scrollTop by exactly
 *  that growth. */
async function revealOlderMessages() {
  const element = scroller.value;
  if (!element) return;
  const heightBefore = element.scrollHeight;
  const topBefore = element.scrollTop;
  visibleCount.value += HISTORY_WINDOW;
  await nextTick();
  element.scrollTop = element.scrollHeight - heightBefore + topBefore;
}

function onScroll() {
  const element = scroller.value;
  if (!element) return;
  const distanceFromBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight;
  if (isAutoScrolling.value) {
    if (distanceFromBottom < 4) isAutoScrolling.value = false;
    return;
  }
  isPinnedToBottom.value = distanceFromBottom < 48;
  if (element.scrollTop < 80 && hiddenOlderCount.value > 0) {
    void revealOlderMessages();
  }
}

// The stream mounts with its history already loaded (the host v-ifs it behind
// the fetch), so the growth watchers below never see that first fill — open at
// the latest message explicitly. NOT when a pointer anchor owns the open
// position: the landing watch resolves on the SAME flush and this bottom
// scroll would attach after it and win the race, silently yanking the view
// off the anchor (the reviewer-caught mount-scroll race).
onMounted(async () => {
  if (props.scrollToTraceId != null) return;
  await nextTick();
  scrollToBottom();
});

// Follow the live edge (new rows, streaming text, tool cards) while pinned.
watch(
  () => [
    props.messages.length,
    props.activeTurn?.segments.reduce(
      (size, segment) => size + segment.text.length + segment.toolCalls.length,
      0,
    ) ?? 0,
  ],
  async () => {
    if (!isPinnedToBottom.value) return;
    await nextTick();
    scrollToBottom();
  },
);

// Your own send always jumps to the bottom, wherever you were reading.
watch(
  () => props.activeTurn?.userMessage?.id ?? null,
  async (id) => {
    if (id === null) return;
    await nextTick();
    scrollToBottom();
  },
);

// A different session (history pick, target swap) starts fresh: newest window,
// pinned at the latest message.
watch(
  () => props.messages[0]?.sessionId ?? null,
  async () => {
    visibleCount.value = HISTORY_WINDOW;
    await nextTick();
    scrollToBottom();
  },
);

// The pointer's landing (redesign Case 1): reveal + scroll to the row carrying
// the anchor trace key and flash it — once per anchor; the scroll handler
// unpins from the bottom naturally. An older-than-window anchor reveals the
// full history first, then the re-fired watch lands on it.
let landedTraceId: string | null = null;
watch(
  () => [props.scrollToTraceId, visibleMessages.value.length] as const,
  async ([traceId]) => {
    if (traceId == null || landedTraceId === traceId) return;
    // A folded turn hides its rows — unfold the anchor's turn first so the
    // landing has a row to land on.
    const anchorRow = visibleMessages.value.find(
      (message) => message.partialSessionId === traceId,
    );
    if (anchorRow !== undefined) expandTurnOf(anchorRow.id);
    await nextTick();
    const row = scroller.value?.querySelector(`[data-trace-id="${traceId}"]`);
    if (!(row instanceof HTMLElement)) {
      if (hiddenOlderCount.value > 0)
        visibleCount.value = props.messages.length;
      return;
    }
    landedTraceId = traceId;
    row.scrollIntoView({ block: "center" });
    row.classList.add("pointer-anchor-flash");
    window.setTimeout(() => row.classList.remove("pointer-anchor-flash"), 1600);
  },
  { immediate: true },
);
</script>

<template>
  <div class="thread-stream">
    <div ref="scroller" class="thread-scroller" @scroll.passive="onScroll">
      <div class="thread-column">
        <p v-if="hiddenOlderCount > 0" class="older-note">
          {{ hiddenOlderCount }} earlier
          {{ hiddenOlderCount === 1 ? "message" : "messages" }} — scroll up to
          load
        </p>

        <template v-for="(message, index) in visibleMessages" :key="message.id">
          <!-- A folded turn renders only its header row (the strip); its
               continuations wait behind the chevron. Pointers render
               regardless — a tracker never hides with its turn. -->
          <MessageRow
            v-if="showsHeaderFor(index) || isTurnExpanded(turnKeyAt(index))"
            :message="message"
            :data-trace-id="message.partialSessionId ?? undefined"
            :class="{ 'is-continuation': !showsHeaderFor(index) }"
            :assistant-name="props.assistantName"
            :assistant-icon-url="props.assistantIconUrl"
            :author-persona="authorPersonaFor(message)"
            :workspace-badge="workspaceBadgeFor(message)"
            :show-header="showsHeaderFor(index)"
            :collapsible="showsHeaderFor(index)"
            :collapsed="!isTurnExpanded(turnKeyAt(index))"
            :preview-fallback="turnPreviewFallbackFor(turnKeyAt(index))"
            @toggle-collapse="toggleTurn(turnKeyAt(index))"
          >
            <template
              v-if="props.toolCallsByMessageId[message.id]?.length"
              #tool-calls
            >
              <ToolCallList
                class="tool-list"
                :tool-calls="props.toolCallsByMessageId[message.id] ?? []"
              />
            </template>
          </MessageRow>
          <PointerRow
            v-for="pointer in pointersByMessageId.get(message.id) ?? []"
            :key="pointer.partialSessionId"
            :pointer="pointer"
            @open="emit('openPointer', pointer)"
          />
        </template>

        <template v-if="props.activeTurn">
          <MessageRow
            v-if="props.activeTurn.userMessage"
            :message="props.activeTurn.userMessage"
          />
          <LiveTurn
            :view="props.activeTurn"
            :author-label="props.assistantName"
            :author-icon-url="props.assistantIconUrl"
            @decide-approval="
              (id, decision) => emit('decideApproval', id, decision)
            "
          />
        </template>
      </div>
    </div>

    <Transition name="jump-pill">
      <button
        v-if="!isPinnedToBottom"
        type="button"
        class="jump-to-latest"
        @click="scrollToBottom('smooth')"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 6l5 5 5-5"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        Jump to latest
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.thread-stream {
  position: relative;
  height: 100%;
  min-height: 0;
}

.thread-scroller {
  height: 100%;
  overflow-y: auto;
  /* The thread never side-scrolls — text reflows to the host's width (the
     sidebar is narrow and resizable); wide content scrolls inside its own
     card, never the whole column. */
  overflow-x: hidden;
}

.thread-column {
  max-width: 920px;
  margin: 0 auto;
  padding: 24px 24px 16px;
  display: grid;
  gap: 20px;
}

/* Grid items default min-width:auto — one nowrap preview or long token would
   floor the column track past the container and side-scroll every row. */
.thread-column > * {
  min-width: 0;
}

.older-note {
  margin: 0;
  text-align: center;
  color: var(--ink-3);
  font: 500 11px/1.5 var(--font-ui);
}

/* A headerless continuation row sits close to the row it extends — the same
   8px rhythm the live overlay gives its segments (grid gap is 20px). */
.is-continuation {
  margin-top: -12px;
}

.tool-list {
  margin-top: 4px;
}

.jump-to-latest {
  appearance: none;
  position: absolute;
  bottom: 14px;
  left: 50%;
  translate: -50% 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--hair-strong);
  border-radius: 99px;
  background: var(--bg-raised);
  box-shadow: var(--shadow-raised);
  color: var(--ink-1);
  font: 600 11.5px/1.5 var(--font-ui);
  cursor: default;
}

.jump-to-latest:hover {
  border-color: var(--gold);
}

.jump-to-latest:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}

.jump-to-latest svg {
  color: var(--ink-3);
}

.jump-pill-enter-active,
.jump-pill-leave-active {
  transition:
    opacity var(--t-fast) var(--ease-out),
    translate var(--t-fast) var(--ease-out);
}

.jump-pill-enter-from,
.jump-pill-leave-to {
  opacity: 0;
  translate: -50% 6px;
}

@media (prefers-reduced-motion: reduce) {
  .jump-pill-enter-active,
  .jump-pill-leave-active {
    transition: none;
  }
}
/* The pointer's landing flash — a brief gold wash on the anchor row (gold =
   presence: the row the live task started from). */
:deep(.pointer-anchor-flash) {
  animation: pointer-anchor-flash 1.6s ease-out;
}
@keyframes pointer-anchor-flash {
  0% {
    background: var(--gold-soft);
  }
  100% {
    background: transparent;
  }
}
</style>
