<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type {
  ChatMessageResponse,
  ChatToolCallResponse,
} from "@vynel/contracts/chat/chat-http";
import { MessageRow, ToolCallList } from "@vynel/ui";
import type { ActiveTurnView } from "../../composables/chat/active-turn-view.js";
import type { ActivitySource } from "../../composables/activity/use-activity-monitor.js";
import type { PersonaLiveCardModel } from "../../composables/delegations/use-live-delegation-cards.js";
import LiveTurn from "./LiveTurn.vue";
import PersonaLiveCard from "./PersonaLiveCard.vue";
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
    /** False on a SESSION view — a pipeline leaf shows agent chips only, no
     *  trace/report chips at all (scoping rule 3). Threads (global/workspace)
     *  keep the default and rely on the received-trace discriminator below. */
    showWatchChips?: boolean;
    /** The trace keys with a LIVE delegation right now (the host computes it
     *  from the in-flight poll) — a matching row's watch chip pulses live. */
    liveTraceIds?: Set<string> | undefined;
    /** The inline persona cards at the thread's live edge (persona-sessions
     *  B5) — one per in-flight task, rendered like typing indicators. */
    liveCards?: PersonaLiveCardModel[] | undefined;
  }>(),
  {
    assistantName: "Assistant",
    assistantIconUrl: null,
    showWatchChips: true,
    liveTraceIds: undefined,
    liveCards: undefined,
  },
);

const emit = defineEmits<{
  decideApproval: [approvalRequestId: string, decision: "approved" | "denied"];
  /** A persona card's Watch — open the delegation's live view. */
  openCard: [partialSessionId: string];
  /** A persona card's Stop. */
  stopCard: [partialSessionId: string];
  /** A message's delegation chip: open that session's live view. */
  openSession: [sessionId: string];
  /** A report/update box's "View" chip — the host opens the shared dialog. */
  openReport: [
    report: { sourceLabel: string; body: string; kind: "report" | "update" },
  ];
  /** The live-card overflow line ("+N more running") — the full roster. */
  openBackground: [];
  /** An Agent card's Watch chip: open the focused agent view over the source
   *  that carries the agent's activity (trace for delegation-traced rows, the
   *  row's own session for a direct turn's agent). */
  watchAgent: [source: ActivitySource, toolUseId: string];
}>();

/** The activity source an Agent card's Watch chip opens over: a
 *  delegation-traced row streams on its trace channel; a DIRECT turn's agent
 *  has no trace — its activity lives on the session the turn ran on (live map
 *  while running, persisted subagent fields after settle). */
function agentWatchSourceFor(message: ChatMessageResponse): ActivitySource {
  return message.partialSessionId != null
    ? { kind: "trace", id: message.partialSessionId }
    : { kind: "session", id: message.sessionId };
}

// A persona-attributed row (a manager's reply, a colleague's report/update)
// wears ITS OWN face in the author line (B8) — resolved from the label the
// same way the live cards resolve theirs. No workspaceId at row level, so the
// customized image stays with the cards; the monogram + accent carry here.
const { resolvePersona } = usePersonaResolver();
function authorPersonaFor(message: ChatMessageResponse) {
  const isPersonaRow =
    (message.sourceKind === "workspace-manager" ||
      message.sourceKind === "agent") &&
    message.sourceLabel != null;
  return isPersonaRow
    ? resolvePersona({ name: message.sourceLabel!, workspaceId: null })
    : null;
}

// The received-vs-sent discriminator (empirical, from how rows land): a
// delegation that TARGETED this thread persists its ATTRIBUTED inbound row
// HERE as `role:'user'` + a non-null sourceKind carrying the trace key — a
// routed task lands as 'global-root' (the shared pipeline's
// messageAttribution — delegate-to-workspace-root / delegate-to-spawned-
// session), and a report-delivery NOTIFY turn lands as 'workspace-manager'
// + the child's label (session-comms). The replies share that key. Work this
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

function showsWatchChipFor(message: ChatMessageResponse): boolean {
  if (!props.showWatchChips) return false;
  return (
    message.partialSessionId == null ||
    !receivedTraceIds.value.has(message.partialSessionId)
  );
}

// Thread-bottom real estate is finite: many parallel tasks cap at a few
// cards + an overflow count (the Background panel is the full roster, B7).
const VISIBLE_CARD_CAP = 4;
const visibleCards = computed(() => (props.liveCards ?? []).slice(0, VISIBLE_CARD_CAP));
const overflowCardCount = computed(
  () => Math.max(0, (props.liveCards ?? []).length - VISIBLE_CARD_CAP),
);

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

function showsHeaderFor(index: number): boolean {
  const message = visibleMessages.value[index];
  const previous = visibleMessages.value[index - 1];
  if (!message || !previous) return true;
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
// the latest message explicitly.
onMounted(async () => {
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
          <MessageRow
            :message="message"
            :class="{ 'is-continuation': !showsHeaderFor(index) }"
            :assistant-name="props.assistantName"
            :assistant-icon-url="props.assistantIconUrl"
            :author-persona="authorPersonaFor(message)"
            :show-header="showsHeaderFor(index)"
            :show-watch-chip="showsWatchChipFor(message)"
            :linked-session-live="
              message.partialSessionId != null &&
              (props.liveTraceIds?.has(message.partialSessionId) ?? false)
            "
            @open-session="(id) => emit('openSession', id)"
            @open-report="(report) => emit('openReport', report)"
          >
            <template
              v-if="props.toolCallsByMessageId[message.id]?.length"
              #tool-calls
            >
              <!-- Every Agent card gets a Watch chip: traced rows open over
                   the delegation's trace channel, direct rows over the
                   session itself (agentWatchSourceFor). -->
              <ToolCallList
                class="tool-list"
                :tool-calls="props.toolCallsByMessageId[message.id] ?? []"
                watchable-agents
                @watch-agent="
                  (toolCall) =>
                    emit('watchAgent', agentWatchSourceFor(message), toolCall.toolUseId)
                "
                @open-delegation="(id) => emit('openSession', id)"
              />
            </template>
          </MessageRow>
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

        <!-- The live edge's PEOPLE (persona-sessions B5): one card per
             in-flight task, like typing indicators — they render no message
             text, so the settled ack/report rows never contest them. -->
        <TransitionGroup
          v-if="visibleCards.length > 0"
          name="narration"
          tag="div"
          class="grid gap-2 pt-1"
        >
          <PersonaLiveCard
            v-for="card in visibleCards"
            :key="card.key"
            :card="card"
            @open="card.partialSessionId && emit('openCard', card.partialSessionId)"
            @stop="card.partialSessionId && emit('stopCard', card.partialSessionId)"
          />
          <button
            v-if="overflowCardCount > 0"
            key="overflow"
            type="button"
            class="m-0 mx-auto text-[11px] text-[var(--ink-3)] hover:text-[var(--ink-1)]"
            data-testid="live-cards-overflow"
            @click="emit('openBackground')"
          >
            +{{ overflowCardCount }} more running
          </button>
        </TransitionGroup>
      </div>
    </div>

    <Transition name="jump-pill">
      <button
        v-if="!isPinnedToBottom"
        type="button"
        class="jump-to-latest"
        @click="scrollToBottom('smooth')"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
}

.thread-column {
  max-width: 920px;
  margin: 0 auto;
  padding: 24px 24px 16px;
  display: grid;
  gap: 20px;
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
</style>
