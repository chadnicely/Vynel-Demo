<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  PhCheckCircle as CheckCircle,
  PhDisc as Disc,
  PhHandTap as HandTap,
  PhWarningCircle as WarningCircle,
} from "@phosphor-icons/vue";
import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";
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
import { useTickingElapsed } from "../../composables/chat/use-ticking-elapsed.js";
import { useTurnReference } from "../../composables/chat/use-turn-reference.js";

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
    /** The displayed session's model — names the model in the per-turn
     *  run-stats card (messages don't carry one). Null/omitted = "default". */
    sessionModel?: string | null;
    /** The scope's effective status (one status, one colour — Arc 5b): the
     *  needs-input / problem / completed states re-tint the live pill and
     *  stamp the latest card with the state treatment. Null/running/
     *  not_running = the plain working look. */
    workspaceStatus?: WorkspaceEffectiveStatus | null;
  }>(),
  {
    assistantName: "Assistant",
    assistantIconUrl: null,
    pointersByTraceId: undefined,
    scrollToTraceId: undefined,
    workspacesByName: undefined,
    sessionModel: null,
    workspaceStatus: null,
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

// The marked turn (Kafi, 2026-08-15): a card's chat icon pins it, and the
// composer spends the mark on the next send. The thread owns neither end —
// it just reports the click and lights the marked card.
const { markedMessageId, mark: markTurnReference } = useTurnReference();

function referenceAuthorFor(message: ChatMessageResponse): string {
  if (message.role === "user") return "You";
  return message.sourceLabel ?? props.assistantName;
}

// The workspace chip beside a persona row's author (Chad, 2026-08-09): the
// label's LAST " · " segment (the persona-first rule) resolves to an
// icon/monogram + accent; hover shows the profile card. The host's name→id
// map unlocks the customized image + color. EVERY persona-stamped row wears
// it — the delivered colleague row in Global and the persona's own reply in
// its workspace read as the same participant (2026-08-09 parity pass).
const customize = useCustomizeStore();

function workspaceChip(name: string) {
  const workspaceId = props.workspacesByName?.[name] ?? null;
  const custom =
    workspaceId !== null ? customize.customizationFor(workspaceId) : null;
  return {
    name,
    imageUrl: custom?.workspaceImage ?? null,
    monogram: workspaceMonogram(name),
    accentVar: `--ws-${custom?.colorSlot ?? workspaceColorSlot(name)}`,
  };
}

function workspaceBadgeFor(message: ChatMessageResponse) {
  // A persona-stamped row: the label's workspace segment is the chip.
  if (
    (message.sourceKind === "agent" ||
      message.sourceKind === "workspace-manager") &&
    message.sourceLabel != null
  ) {
    const { workspace } = splitSourceLabel(message.sourceLabel);
    return workspace === null ? null : workspaceChip(workspace);
  }
  // A relayed task anchor / mention row: the label IS the origin scope
  // (Chad, 2026-08-09: the "from X" text becomes the chip — Global wears
  // the house glyph, a workspace origin its own icon). Known workspaces
  // win over the literal name "Global" so a workspace named Global keeps
  // its identity.
  if (
    message.role === "user" &&
    (message.sourceKind === "global-root" || message.sourceKind === "user") &&
    message.sourceLabel != null
  ) {
    const name = message.sourceLabel;
    if (props.workspacesByName?.[name] === undefined && name === "Global") {
      return {
        name: "Global",
        imageUrl: null,
        monogram: "G",
        accentVar: "",
        isGlobal: true,
      };
    }
    return workspaceChip(name);
  }
  return null;
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

const hiddenOlderCount = computed(() =>
  Math.max(0, settledMessages.value.length - visibleCount.value),
);

// AUTHOR-RUN keys — consecutive same-author assistant rows share one key, so
// a reloaded multi-row turn reads under ONE author line (header/continuation
// decisions only; the CARD boundary is the conversation grouping below).
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

// CONVERSATION cards (workspace redesign Arc 5b — the canvas's "one card per
// exchange"): a user's ask and the assistant's whole reply share ONE card.
// Any user-authored row (an ask, a delivered report, a mention) starts a new
// exchange; the assistant rows that follow ride along. An assistant-led turn
// with no ask (a schedule fire, a channel reply) starts its own card via the
// author-run boundary.
function startsNewCard(
  message: ChatMessageResponse,
  previous: ChatMessageResponse | undefined,
): boolean {
  if (!previous) return true;
  if (message.role === "user") return true;
  if (previous.role === "user") return false;
  return startsNewTurn(message, previous);
}

// Folding (Chad, 2026-08-09, re-grouped by the Arc 5b card): every card folds
// to its header strip; only the LATEST card is open by default; a manual
// toggle overrides its card from then on. Keys derive from the FULL settled
// history, not the window — revealing an older page must never re-key a card
// cut at the window boundary (that would orphan a manual fold override, the
// Gate-3 catch).
const cardKeyByMessageId = computed(() => {
  const keys = new Map<string, string>();
  let current: string | null = null;
  settledMessages.value.forEach((message, index) => {
    if (
      current === null ||
      startsNewCard(message, settledMessages.value[index - 1])
    ) {
      current = message.id;
    }
    keys.set(message.id, current);
  });
  return keys;
});
const latestCardKey = computed(() => {
  const last = settledMessages.value.at(-1);
  return last === undefined
    ? null
    : (cardKeyByMessageId.value.get(last.id) ?? null);
});
const collapseOverrides = ref(new Map<string, boolean>());

function isCardExpanded(cardKey: string): boolean {
  return (
    collapseOverrides.value.get(cardKey) ?? cardKey === latestCardKey.value
  );
}

function toggleCard(cardKey: string) {
  const next = new Map(collapseOverrides.value);
  next.set(cardKey, !isCardExpanded(cardKey));
  collapseOverrides.value = next;
}

function expandCardOf(messageId: string) {
  const key = cardKeyByMessageId.value.get(messageId);
  if (key === undefined || isCardExpanded(key)) return;
  const next = new Map(collapseOverrides.value);
  next.set(key, true);
  collapseOverrides.value = next;
}

// The folded strip's preview when the card's HEADER row has no text (an
// exchange opening with tool calls): the first non-empty body among the
// card's rows, else its first tool call as a one-line summary
// ("Read CLAUDE.md") — an empty strip tells the user nothing.
const cardPreviewFallbacks = computed(() => {
  const bodyLines = new Map<string, string>();
  const toolLines = new Map<string, string>();
  for (const message of settledMessages.value) {
    const cardKey = cardKeyByMessageId.value.get(message.id) ?? message.id;
    if (!bodyLines.has(cardKey)) {
      // Marker-stripped, matching the row's own displayBody — the model-facing
      // "[Report from …]" line must never surface as a strip preview.
      const firstLine = stripReportMessageMarker(message.body)
        .split("\n")
        .find((line) => line.trim() !== "");
      if (firstLine !== undefined) bodyLines.set(cardKey, firstLine);
    }
    if (!toolLines.has(cardKey)) {
      const firstCall = props.toolCallsByMessageId[message.id]?.[0];
      if (firstCall !== undefined) {
        const { verb, argument } = presentToolCall(firstCall);
        toolLines.set(
          cardKey,
          argument === null ? verb : `${verb} ${argument}`,
        );
      }
    }
  }
  return { bodyLines, toolLines };
});

function cardPreviewFallbackFor(cardKey: string): string | null {
  const { bodyLines, toolLines } = cardPreviewFallbacks.value;
  return bodyLines.get(cardKey) ?? toolLines.get(cardKey) ?? null;
}

// The visible window grouped into CONVERSATION CARDS (workspace redesign
// Arc 3 + 5b): one wrapper per exchange, so the card lifecycle — folded past
// exchanges dim to grayscale strips, the expanded one reads as a quiet card,
// the live one glows — is one class on one element. A window-cut card's first
// visible row acts as its header (same behavior the flat list had when the
// previous row was off-window).
const turnCardGroups = computed(() => {
  const groups: { key: string; messages: ChatMessageResponse[] }[] = [];
  for (const message of visibleMessages.value) {
    const key = cardKeyByMessageId.value.get(message.id) ?? message.id;
    const last = groups.at(-1);
    if (last !== undefined && last.key === key) last.messages.push(message);
    else groups.push({ key, messages: [message] });
  }
  return groups;
});

// Header/continuation decisions inside a card ride the AUTHOR-RUN keys: the
// reply's first row shows its author line under the ask; its further rows
// continue headerless. The reply's first row also wears the canvas's
// hairline divider (`is-reply-start`).
function memberShowsHeader(
  group: { messages: ChatMessageResponse[] },
  memberIndex: number,
): boolean {
  if (memberIndex === 0) return true;
  const message = group.messages[memberIndex]!;
  const previous = group.messages[memberIndex - 1]!;
  return (
    turnKeyByMessageId.value.get(message.id) !==
    turnKeyByMessageId.value.get(previous.id)
  );
}

function memberStartsReply(
  group: { messages: ChatMessageResponse[] },
  memberIndex: number,
): boolean {
  if (memberIndex === 0) return false;
  const message = group.messages[memberIndex]!;
  const previous = group.messages[memberIndex - 1]!;
  return message.role === "assistant" && previous.role === "user";
}

// The run-stats door sits on the REPLY's author line (the canvas's info
// icon beside VYNEL), never on the ask.
// The stats door rides the row that DRAWS the reply's lead glyph — the canvas
// marks a card exactly once, at the head of the answer. A turn that opens with
// tool calls has an empty first assistant row, so anchoring on that one leaves
// the door in the header while a later row draws a second glyph beside it.
function statsMemberIndexOf(group: { messages: ChatMessageResponse[] }): number {
  const leadIndex = group.messages.findIndex(
    (message) => message.role === "assistant" && message.body.trim() !== "",
  );
  if (leadIndex !== -1) return leadIndex;
  return group.messages.findIndex((message) => message.role === "assistant");
}

// The live card's top-right working pill — the canvas's "working · 8m 15s"
// signature. Same composable as LiveTurn's chip (independent 1s ticks, so a
// transient 1s disagreement is possible and harmless).
const workingElapsed = useTickingElapsed(
  () => props.activeTurn?.startedAtMs ?? null,
  () => props.activeTurn?.status === "streaming",
);

// The state treatments (the Needs Input / Problem / Completed canvases): the
// scope's status swaps the pill's icon/label/hue and, when no turn streams,
// stamps the LATEST card with the state chrome + a solid state spine.
const STATE_PILLS = {
  needs_input: { label: "Needs input", icon: HandTap },
  problem: { label: "Hit a problem", icon: WarningCircle },
  completed: { label: "Completed", icon: CheckCircle },
} as const;

const stateVariant = computed<keyof typeof STATE_PILLS | null>(() => {
  const status = props.workspaceStatus;
  return status === "needs_input" || status === "problem" || status === "completed"
    ? status
    : null;
});

function isStatedCard(cardKey: string): boolean {
  return (
    stateVariant.value !== null &&
    props.activeTurn === null &&
    cardKey === latestCardKey.value &&
    isCardExpanded(cardKey)
  );
}

// The per-turn run stats (Chad, 2026-08-09: EVERY assistant turn wears the
// info door, not just delivered rows): tool calls, tokens, and duration
// aggregated over the turn's assistant rows. A row's inputTokens is the
// request's WHOLE context occupancy — so the turn's "in" is its occupancy
// GROWTH over the previous turn (what this turn added: the ask, tool
// results, its reply), and the occupancy itself rides along as
// `contextTokens`. Output sums correctly (per-row fresh tokens).
const turnRunStats = computed(() => {
  const byTurn = new Map<
    string,
    {
      toolCallCount: number;
      baseline: number | null;
      contextTokens: number | null;
      outputTokens: number | null;
      startedAt: number | null;
      completedAt: number | null;
    }
  >();
  // The last occupancy seen across the whole thread, in order — each turn's
  // pre-turn baseline.
  let runningOccupancy: number | null = null;
  for (const message of settledMessages.value) {
    if (message.role !== "assistant") continue;
    const turnKey = cardKeyByMessageId.value.get(message.id) ?? message.id;
    const entry = byTurn.get(turnKey) ?? {
      toolCallCount: 0,
      baseline: runningOccupancy,
      contextTokens: null,
      outputTokens: null,
      startedAt: null,
      completedAt: null,
    };
    entry.toolCallCount += props.toolCallsByMessageId[message.id]?.length ?? 0;
    if (message.inputTokens !== null) {
      entry.contextTokens = message.inputTokens;
      runningOccupancy = message.inputTokens;
    }
    if (message.outputTokens !== null)
      entry.outputTokens = (entry.outputTokens ?? 0) + message.outputTokens;
    if (message.startedAt !== null) {
      const startMs = new Date(message.startedAt).getTime();
      entry.startedAt =
        entry.startedAt === null ? startMs : Math.min(entry.startedAt, startMs);
    }
    if (message.completedAt !== null) {
      const endMs = new Date(message.completedAt).getTime();
      entry.completedAt =
        entry.completedAt === null ? endMs : Math.max(entry.completedAt, endMs);
    }
    byTurn.set(turnKey, entry);
  }
  return byTurn;
});

function turnRunStatsFor(turnKey: string) {
  const entry = turnRunStats.value.get(turnKey);
  if (entry === undefined) return null;
  const durationMs =
    entry.startedAt !== null && entry.completedAt !== null
      ? Math.max(0, entry.completedAt - entry.startedAt)
      : null;
  // No usage and no duration = nothing worth a door (a just-started turn).
  if (
    entry.contextTokens === null &&
    entry.outputTokens === null &&
    durationMs === null
  ) {
    return null;
  }
  // Occupancy shrank across the turn boundary (a compaction swap) — a
  // negative "added" figure would lie; the context row still tells the story.
  const grewFrom = entry.baseline ?? 0;
  const inputTokens =
    entry.contextTokens !== null && entry.contextTokens >= grewFrom
      ? entry.contextTokens - grewFrom
      : null;
  return {
    model: props.sessionModel,
    toolCallCount: entry.toolCallCount,
    inputTokens,
    outputTokens: entry.outputTokens,
    contextTokens: entry.contextTokens,
    durationMs,
  };
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
    // A folded card hides its rows — unfold the anchor's card first so the
    // landing has a row to land on.
    const anchorRow = visibleMessages.value.find(
      (message) => message.partialSessionId === traceId,
    );
    if (anchorRow !== undefined) expandCardOf(anchorRow.id);
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

        <!-- The conversation cards (workspace redesign Arc 3 + 5b): ONE card
             per exchange — the ask and its whole reply together, the canvas's
             chat shape. Folded past cards dim to grayscale strips and wake on
             hover; the expanded card is a quiet hairline card. A folded card
             renders only its header row; pointers render regardless — a
             tracker never hides with its card. -->
        <section
          v-for="group in turnCardGroups"
          :key="group.key"
          class="turn-card"
          :class="[
            isCardExpanded(group.key) ? 'is-open' : 'is-folded',
            isStatedCard(group.key) ? `is-stated is-state-${stateVariant}` : '',
          ]"
        >
          <!-- The state pill (Needs Input / Problem / Completed canvases) —
               the latest exchange wears the scope's status verdict. -->
          <span
            v-if="isStatedCard(group.key) && stateVariant"
            class="state-spine"
            aria-hidden="true"
          />
          <span
            v-if="isStatedCard(group.key) && stateVariant"
            class="status-pill"
            :data-status="stateVariant"
          >
            <component :is="STATE_PILLS[stateVariant].icon" :size="13" class="status-pill-icon" />
            <span class="status-pill-label">{{ STATE_PILLS[stateVariant].label }}</span>
          </span>
          <template
            v-for="(message, memberIndex) in group.messages"
            :key="message.id"
          >
            <MessageRow
              v-if="memberIndex === 0 || isCardExpanded(group.key)"
              :message="message"
              :data-trace-id="message.partialSessionId ?? undefined"
              :class="{
                'is-continuation':
                  memberIndex > 0 && !memberShowsHeader(group, memberIndex),
                'is-reply-start': memberStartsReply(group, memberIndex),
              }"
              :assistant-name="props.assistantName"
              :assistant-icon-url="props.assistantIconUrl"
              :author-persona="authorPersonaFor(message)"
              :workspace-badge="workspaceBadgeFor(message)"
              :show-header="memberShowsHeader(group, memberIndex)"
              :collapsible="memberIndex === 0"
              :collapsed="!isCardExpanded(group.key)"
              :preview-fallback="cardPreviewFallbackFor(group.key)"
              :referenced="markedMessageId === message.id"
              :run-stats="
                memberIndex === statsMemberIndexOf(group)
                  ? turnRunStatsFor(group.key)
                  : null
              "
              @toggle-collapse="toggleCard(group.key)"
              @toggle-reference="
                markTurnReference(message, referenceAuthorFor(message))
              "
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
        </section>

        <!-- The live card — the canvas's glowing accent treatment: tinted
             ground, accent spine sweeping the left edge, the working pill
             ticking top-right. A pending approval/ask (needs_input) or a
             set problem re-tints the pill per the state canvases. -->
        <section
          v-if="props.activeTurn"
          class="turn-card is-live"
          :class="stateVariant ? `is-state-${stateVariant}` : ''"
        >
          <!-- Motion only while genuinely streaming — the settle window keeps
               the tinted ground with LiveTurn's quiet done chip, and an error
               note must not sit beside a sweeping light. -->
          <span
            v-if="props.activeTurn.status === 'streaming' && !stateVariant"
            class="live-spine"
            aria-hidden="true"
          />
          <span
            v-if="props.activeTurn.status === 'streaming' && stateVariant"
            class="state-spine"
            aria-hidden="true"
          />
          <span
            v-if="props.activeTurn.status === 'streaming' && stateVariant"
            class="status-pill"
            :data-status="stateVariant"
          >
            <component :is="STATE_PILLS[stateVariant].icon" :size="13" class="status-pill-icon" />
            <span class="status-pill-label">{{ STATE_PILLS[stateVariant].label }}</span>
            <template v-if="workingElapsed">
              <span class="status-pill-sep" aria-hidden="true" />
              <span class="status-pill-time">{{ workingElapsed }}</span>
            </template>
          </span>
          <span
            v-else-if="props.activeTurn.status === 'streaming' && workingElapsed"
            class="working-pill"
          >
            <Disc :size="13" class="working-disc" aria-hidden="true" />
            <span class="working-label">{{ props.assistantName }} working</span>
            <span class="working-sep" aria-hidden="true" />
            <span class="working-time">{{ workingElapsed }}</span>
          </span>
          <MessageRow
            v-if="props.activeTurn.userMessage"
            :message="props.activeTurn.userMessage"
            class="live-user-row"
          />
          <LiveTurn
            :view="props.activeTurn"
            :author-label="props.assistantName"
            :author-icon-url="props.assistantIconUrl"
            @decide-approval="
              (id, decision) => emit('decideApproval', id, decision)
            "
          />
        </section>
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

/* The canvas's thread is FULL-BLEED in its column — 22.4px gutters, no
   centred reading measure (Kafi, 2026-08-15). The gutter is a variable so a
   narrow mount can tighten it: within one panel the composer and the messages
   MUST share an edge, so whoever changes one sets both. */
.thread-column {
  padding: 16px var(--thread-gutter, 22.4px) 11.2px;
  display: grid;
  gap: 12px;
}

/* ── The conversation cards (workspace redesign Arc 3 + 5b). One element per
   exchange; the lifecycle is a class swap: folded past cards are dim
   grayscale strips that wake on hover, the open card sits on the surface
   ground, the live card glows on the accent ground with the spine + working
   pill. Paddings/gaps are the canvas's values verbatim. ── */
.turn-card {
  display: grid;
  gap: 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-m);
  padding: 14px 22px 18px;
  transition:
    border-color var(--t-fast) var(--ease-out),
    background var(--t-fast) var(--ease-out),
    opacity var(--t-fast) var(--ease-out);
}

/* The rows moved one grid level deeper — the card re-applies the column's
   min-width guard, or one long unbroken token floors the internal track
   past the card (grid items default min-width:auto). */
.turn-card > * {
  min-width: 0;
}

.turn-card.is-open {
  border-color: var(--hair);
  background: var(--bg-raised);
}

.turn-card.is-folded {
  gap: 8px;
  padding: 11px 22px 12px;
  /* PRE-COMPOSITED, and that is the whole point: the canvas fades the entire
     card (`cardOpacity: .3`), so its `divider x 55%` edge lands at ~2.6%
     alpha — all but invisible, which is why settled turns read there as dim
     floating text. We cannot copy that opacity (it rides the members instead,
     so a live tracker's gold presence dot survives — see below), so the edge
     carries the composite itself. Using the canvas's raw 55% here renders a
     stack of boxes: same declared value, completely different picture. */
  border-color: color-mix(in srgb, var(--hair) 16.5%, transparent);
}

/* Waking a card: the canvas lifts it to opacity .75 over a neutral-700 edge —
   composited the same way. */
.turn-card.is-folded:hover {
  border-color: color-mix(in srgb, var(--color-neutral-700) 75%, transparent);
  background: color-mix(in srgb, var(--color-text) 4%, var(--bg-raised));
}

/* The dim rides the MEMBERS, not the card — an ancestor filter would also
   grayscale a live tracker's gold presence dot (PointerRow renders under
   folded cards on purpose; gold = presence, the one rule). Canvas values:
   0.3 + grayscale(1) at rest, 0.75 + grayscale(0.25) awake. */
.turn-card.is-folded > :deep(.message-row) {
  opacity: 0.3;
  filter: grayscale(1);
  transition:
    opacity var(--t-slow) var(--ease-out),
    filter var(--t-slow) var(--ease-out);
}

.turn-card.is-folded:hover > :deep(.message-row),
.turn-card.is-folded:focus-within > :deep(.message-row) {
  opacity: 0.75;
  filter: grayscale(0.25);
}

.turn-card.is-live {
  position: relative;
  border-color: color-mix(in srgb, var(--gold) 55%, transparent);
  border-left: 2px solid var(--gold);
  background: var(--color-accent-900);
  /* Room for the working pill so the first row never collides with it. */
  padding-top: 16px;
  overflow: hidden;
}

/* The reply's first row — the canvas's hairline between the ask and the
   reply block inside one card. */
:deep(.is-reply-start) {
  border-top: 1px solid color-mix(in srgb, var(--color-text) 9%, transparent);
  padding-top: 12px;
}

/* ── The state treatments (Needs Input / Problem / Completed canvases): the
   latest card keeps the live ground, swaps the sweep for a SOLID state
   spine, and wears the state pill. One hue per state, everywhere:
   needs-input #38b6ff · problem #f2564b · completed oklch(0.70 0.105 158)
   (Chad's settled decisions, 2026-08-14). ── */
.turn-card.is-stated {
  position: relative;
  border-color: color-mix(in srgb, var(--gold) 55%, transparent);
  background: var(--color-accent-900);
  padding-top: 16px;
  overflow: hidden;
}

/* The RUNNING card lifts its ink onto the accent ground, exactly as the
   canvas does (`nameColor`/`createdColor`/`color` all switch on `live`):
   the author and the ask go accent-100, the timestamp accent-300. The
   identity chip stays neutral — that is who is speaking, not what state the
   card is in. Folded cards reach the canvas's dimmed inks through the
   opacity+grayscale treatment above instead. */
.turn-card.is-live :deep(.role-user:not(.is-report) .role-label),
.turn-card.is-live :deep(.plain-body) {
  color: var(--color-accent-100);
}

.turn-card.is-live :deep(.header-meta) {
  color: var(--color-accent-300);
}

/* The canvas leaves the LEFT edge open on every card but the live one — the
   spine column is the live card's alone (a stated card paints it with the
   `.state-spine` overlay instead). Must follow the rules above: same
   specificity, source order decides. */
.turn-card:not(.is-live) {
  border-left-color: transparent;
}

.state-spine {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  pointer-events: none;
}

.is-state-needs_input .state-spine {
  background: var(--needs-input);
}

.is-state-problem .state-spine {
  background: var(--danger);
}

.is-state-completed .state-spine {
  background: var(--ok);
}

.status-pill {
  position: absolute;
  top: 10px;
  right: 14px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 2px 9px 2px 6px;
  border-radius: 999px;
  background: var(--color-neutral-900);
  max-width: calc(100% - 28px);
}

.status-pill-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 9.5px/1.5 var(--font-ui);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.status-pill-sep {
  width: 1px;
  height: 9px;
}

.status-pill-time {
  font: 500 9.5px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
}

.status-pill[data-status="needs_input"] {
  border: 1px solid color-mix(in srgb, var(--needs-input) 70%, transparent);
}

.status-pill[data-status="needs_input"] .status-pill-icon {
  color: var(--needs-input);
}

.status-pill[data-status="needs_input"] .status-pill-label,
.status-pill[data-status="needs_input"] .status-pill-time {
  color: var(--needs-input);
}

.status-pill[data-status="needs_input"] .status-pill-sep {
  background: color-mix(in srgb, var(--needs-input) 40%, transparent);
}

.status-pill[data-status="problem"] {
  border: 1px solid color-mix(in srgb, var(--danger) 70%, transparent);
}

.status-pill[data-status="problem"] .status-pill-icon {
  color: var(--danger);
}

.status-pill[data-status="problem"] .status-pill-label,
.status-pill[data-status="problem"] .status-pill-time {
  color: var(--danger);
}

.status-pill[data-status="problem"] .status-pill-sep {
  background: color-mix(in srgb, var(--danger) 40%, transparent);
}

.status-pill[data-status="completed"] {
  border: 1px solid color-mix(in srgb, var(--ok) 70%, transparent);
}

.status-pill[data-status="completed"] .status-pill-icon {
  color: var(--ok);
}

.status-pill[data-status="completed"] .status-pill-label,
.status-pill[data-status="completed"] .status-pill-time {
  color: var(--ok);
}

.status-pill[data-status="completed"] .status-pill-sep {
  background: color-mix(in srgb, var(--ok) 40%, transparent);
}

/* The spine — a light sweeping the live card's left edge (the canvas's
   vw-spine), painted inside the rounded border. */
.live-spine {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    var(--color-accent-100) 45%,
    var(--color-accent-100) 55%,
    transparent 100%
  );
  background-size: 100% 55%;
  background-repeat: no-repeat;
  animation: live-spine-sweep 2.6s ease-in-out infinite;
  pointer-events: none;
}

@keyframes live-spine-sweep {
  0% {
    background-position: 0 -140%;
  }
  100% {
    background-position: 0 240%;
  }
}

.working-pill {
  position: absolute;
  top: 10px;
  right: 14px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 2px 9px 2px 6px;
  border-radius: 999px;
  background: var(--color-neutral-900);
  border: 1px solid color-mix(in srgb, var(--gold) 45%, transparent);
  /* A long persona name must never outgrow the card or sit on the ask's
     header — the label ellipsizes inside the capped pill. */
  max-width: calc(100% - 28px);
}

.working-disc {
  color: var(--gold);
  animation: working-disc-spin 3.2s linear infinite;
}

@keyframes working-disc-spin {
  to {
    transform: rotate(360deg);
  }
}

.working-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* Weight 400 like the canvas — the tracking does the work. */
  font: 400 9.5px/1.5 var(--font-ui);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-accent-200);
}

.working-sep {
  width: 1px;
  height: 9px;
  background: color-mix(in srgb, var(--gold) 40%, transparent);
}

.working-time {
  font: 400 9.5px/1.5 var(--font-ui);
  font-variant-numeric: tabular-nums;
  color: var(--color-accent-300);
}

/* The live card's user row leaves room for the pill on narrow hosts. */
.live-user-row {
  padding-right: 120px;
}

@media (prefers-reduced-motion: reduce) {
  .live-spine,
  .working-disc {
    animation: none;
  }
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
   8px rhythm the live overlay gives its segments (grid gap is 14px). */
.is-continuation {
  margin-top: -6px;
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
