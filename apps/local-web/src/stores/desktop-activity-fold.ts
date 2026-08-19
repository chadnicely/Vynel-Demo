import type {
  SessionActivityEvent,
  SessionTurnScopeKind,
} from "@vynel/contracts/chat/session-activity";
import { DESKTOP_TOOL_PREFIX, parseDesktopPlanCard } from "@vynel/ui";

// The pure fold behind the desktop-control overlay: activity-feed events in,
// "what is Claude doing to the desktop right now" out. Only `mcp__desktop__*`
// steps count — a long global turn doing non-desktop work must not surface the
// overlay. Colocated with the store (desktop-activity-store.ts) that holds it;
// pure so the visibility rule is unit-testable with a fake clock.
//
// Visibility is CONTINUOUS while Claude is on the desktop, not per-step: once a
// desktop step arrives the overlay stays up and accumulates the whole progress
// log, hiding only when the turn ends OR after a long idle with no desktop
// activity (the previous 8s per-settle linger made it flicker open/closed
// between steps). `lastActivityAtMs` is stamped on EVERY desktop event.


/** How long the overlay stays up after the LAST desktop activity (any step or
 *  bell), so a multi-step sequence never flickers it closed between steps. */
export const IDLE_HIDE_MS = 20_000;

// Keep the whole desktop-active sequence (the overlay shows a scrollable log),
// bounded so memory can't grow unboundedly on a very long session.
const RECENT_STEP_LIMIT = 50;

export interface DesktopStep {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  status: "running" | "completed" | "failed" | "denied" | "cancelled";
}

/** The plan the user approved for this turn — what Claude said it would do. */
export interface ActiveDesktopPlan {
  goal: string;
  steps: string[];
}

/** The turn currently driving desktop steps — Stop must target THIS one.
 *  `origin`/`partialSessionId` are learned from the turn's `turn-started`
 *  frame; both stay null when the overlay attached mid-turn and never saw it. */
export interface TrackedDesktopTurn {
  turnId: string;
  scopeKind: SessionTurnScopeKind;
  /** 'delegation' = a spawned/background session is driving, NOT the root. */
  origin: string | null;
  /** The delegated turn's stop handle (`root.stopDelegation`). */
  partialSessionId: string | null;
  /** The continuing identity this turn runs ON. Since the session-hardening arc
   *  EVERY global/voice turn carries it (the root's own turn names the global
   *  primary; the spoken thread names the voice primary; a spawned session
   *  names its own), so Stop matches it against the global primary id instead
   *  of reading its absence as "the root". */
  primarySessionId: string | null;
  /** The SDK session the turn runs on — null until the runtime resolves it
   *  (`turn-updated`). The identity-shaped interrupt needs it for a VOICE turn:
   *  the global head would stop the OTHER thread. */
  sessionId: string | null;
}

/** What a `turn-started` frame told us about one turn, kept until that turn
 *  ends. A LOOKUP, not the tracked turn — see `rememberTurn`. */
export type KnownTurn = Omit<TrackedDesktopTurn, "turnId">;

/** How many turns' metadata to retain. Every turn publishes `turn-started`,
 *  including ones that never touch the desktop, so this is bounded. */
const KNOWN_TURN_LIMIT = 24;

export interface DesktopActivityState {
  /** The turn currently driving desktop steps — Stop targets it. */
  trackedTurn: TrackedDesktopTurn | null;
  /** Metadata for turns we've seen start, keyed by turnId. Populated by
   *  `turn-started`; READ when a desktop step tells us which turn matters. */
  knownTurns: Record<string, KnownTurn>;
  /** Newest last, capped — the overlay shows the current + a few settled. */
  steps: DesktopStep[];
  /** Pending desktop approvals (bells; the approvals API owns the state). */
  pendingApprovalIds: string[];
  /** When the last desktop activity happened (ms epoch) — drives the idle hide. */
  lastActivityAtMs: number | null;
  /** Set once a proposed plan is ARMED (its tool call completed) — the moment
   *  Claude goes from looking to controlling. Null while merely observing. */
  activePlan: ActiveDesktopPlan | null;
}

export function emptyDesktopActivity(): DesktopActivityState {
  return {
    trackedTurn: null,
    knownTurns: {},
    steps: [],
    pendingApprovalIds: [],
    lastActivityAtMs: null,
    activePlan: null,
  };
}

const PLAN_TOOL_NAME = `${DESKTOP_TOOL_PREFIX}propose_desktop_plan`;

function isDesktopTool(toolName: string): boolean {
  return toolName.startsWith(DESKTOP_TOOL_PREFIX);
}

/** Whether Claude is CONTROLLING the desktop (an approved plan is armed) as
 *  opposed to merely looking at it. Drives the overlay's banner — the user
 *  should never have to guess which of the two is happening. */
export function isControllingDesktop(state: DesktopActivityState): boolean {
  return state.activePlan !== null;
}

/** Record what a `turn-started` frame said, bounded. */
function rememberTurn(
  knownTurns: DesktopActivityState["knownTurns"],
  turnId: string,
  meta: KnownTurn,
): DesktopActivityState["knownTurns"] {
  const next = { ...knownTurns, [turnId]: meta };
  const ids = Object.keys(next);
  // Insertion order is preserved for string keys, so the first is the oldest.
  if (ids.length > KNOWN_TURN_LIMIT) delete next[ids[0]!];
  return next;
}

/**
 * Which turn the overlay is following, resolved from the DESKTOP step that just
 * arrived — never from `turn-started`.
 *
 * WHY the distinction is the whole bug (live, 2026-08-11). `turn-started` fires
 * for EVERY turn, including the many that never touch the desktop. An earlier
 * version set `trackedTurn` straight from it and ignored later ones, so the
 * fold latched onto the first turn it ever saw — typically a plain chat turn.
 * From then on: the real desktop step arrived under a different turnId and got
 * `origin: null`, which disabled Stop; the old turn's steps never cleared, so a
 * NEW desktop task showed the PREVIOUS one's narration; and `turn-ended` for the
 * real turn never matched, so the overlay wouldn't go away.
 *
 * The step decides who is tracked; `turn-started` only supplies the details.
 */
function trackTurn(state: DesktopActivityState, turnId: string): TrackedDesktopTurn {
  if (state.trackedTurn?.turnId === turnId) return state.trackedTurn;
  const known = state.knownTurns[turnId];
  return {
    turnId,
    scopeKind: known?.scopeKind ?? "global",
    // Null only when we never saw this turn start — Stop then refuses rather
    // than guessing, because firing the ROOT interrupt at a delegated turn
    // kills an unrelated turn and still reports success.
    origin: known?.origin ?? null,
    partialSessionId: known?.partialSessionId ?? null,
    primarySessionId: known?.primarySessionId ?? null,
    sessionId: known?.sessionId ?? null,
  };
}

/** A turn switch means everything on screen belongs to the previous turn.
 *  Shared by BOTH retarget points — a step and an approval bell can each be the
 *  first frame of a new turn, and clearing in only one of them let a new task
 *  render under the old task's log. */
function retargetIfNewTurn(
  state: DesktopActivityState,
  turnId: string,
): DesktopActivityState {
  if (state.trackedTurn === null || state.trackedTurn.turnId === turnId) return state;
  return { ...emptyDesktopActivity(), knownTurns: state.knownTurns };
}

/** Fold one feed event. Returns the same reference when nothing changed. */
export function applyDesktopActivityEvent(
  state: DesktopActivityState,
  event: SessionActivityEvent,
  nowMs: number,
): DesktopActivityState {
  switch (event.kind) {
    case "turn-tool-started": {
      if (!isDesktopTool(event.toolName)) return state;
      const step: DesktopStep = {
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        toolInput: "toolInput" in event ? event.toolInput : undefined,
        status: "running",
      };
      // A DIFFERENT turn is now driving the desktop, so everything on screen
      // belongs to the previous one — start clean rather than appending. Not
      // doing this showed a new desktop task under the OLD task's narration and
      // its approved plan (live, 2026-08-11).
      const carried = retargetIfNewTurn(state, event.turnId);
      // Cap by evicting the oldest SETTLED step first — evicting a running one
      // would drop it from the visibility check and orphan its later settle
      // (the overlay could hide mid-operation).
      const steps = [...carried.steps, step];
      if (steps.length > RECENT_STEP_LIMIT) {
        const evictIndex = steps.findIndex((candidate) => candidate.status !== "running");
        steps.splice(evictIndex === -1 ? 0 : evictIndex, 1);
      }
      return {
        ...carried,
        trackedTurn: trackTurn(carried, event.turnId),
        steps,
        lastActivityAtMs: nowMs,
      };
    }
    case "turn-tool-settled": {
      const index = state.steps.findIndex((step) => step.toolUseId === event.toolUseId);
      if (index === -1) return state;
      const steps = state.steps.slice();
      const settled = { ...steps[index]!, status: event.status };
      steps[index] = settled;
      // A plan that COMPLETED is a plan that was approved and armed (a denied
      // card never runs the tool) — that is the moment Claude stops looking and
      // starts controlling, so the overlay can show what was agreed to.
      const armedPlan =
        settled.status === "completed" && settled.toolName === PLAN_TOOL_NAME
          ? parseDesktopPlanCard(settled.toolInput)
          : null;
      return {
        ...state,
        steps,
        lastActivityAtMs: nowMs,
        ...(armedPlan !== null
          ? { activePlan: { goal: armedPlan.goal, steps: armedPlan.steps } }
          : {}),
      };
    }
    case "turn-approval-requested": {
      if (!isDesktopTool(event.toolName)) return state;
      if (state.pendingApprovalIds.includes(event.approvalRequestId)) return state;
      // A bell can be the FIRST frame of a new turn — an approval often resolves
      // before its tool-call row lands — so this retargets too. Clearing on the
      // step path alone let the new turn's steps append under the old turn's
      // log once its bell had already switched the tracked turn.
      const carried = retargetIfNewTurn(state, event.turnId);
      return {
        ...carried,
        trackedTurn: trackTurn(carried, event.turnId),
        pendingApprovalIds: [...carried.pendingApprovalIds, event.approvalRequestId],
        lastActivityAtMs: nowMs,
      };
    }
    case "turn-approval-resolved": {
      if (!state.pendingApprovalIds.includes(event.approvalRequestId)) return state;
      return {
        ...state,
        pendingApprovalIds: state.pendingApprovalIds.filter(
          (id) => id !== event.approvalRequestId,
        ),
      };
    }
    case "turn-started": {
      // Learn WHO is driving, so Stop can address the right turn — a spawned
      // session's desktop work is stopped through a different route than the
      // root's. This only REMEMBERS; it never decides what the overlay follows,
      // because every turn publishes one of these and most never touch the
      // desktop. Also no visibility change: only a desktop STEP reveals the
      // overlay.
      const meta: KnownTurn = {
        scopeKind: event.scopeKind,
        origin: event.origin,
        partialSessionId: event.partialSessionId ?? null,
        primarySessionId: event.primarySessionId ?? null,
        sessionId: event.sessionId,
      };
      const knownTurns = rememberTurn(state.knownTurns, event.turnId, meta);
      // If this IS the turn already being followed (the feed replays
      // `turn-started` when a client attaches mid-turn), fill in what we
      // previously had to guess.
      return state.trackedTurn?.turnId === event.turnId
        ? { ...state, knownTurns, trackedTurn: { turnId: event.turnId, ...meta } }
        : { ...state, knownTurns };
    }
    case "turn-updated": {
      // The runtime resolved the turn's session mid-turn (a fresh conversation
      // learns its id late) — Stop on a voice turn needs it. Same reference
      // when the turn is not one we know: nothing on the overlay changed.
      const known = state.knownTurns[event.turnId];
      const isTracked = state.trackedTurn?.turnId === event.turnId;
      if (known === undefined && !isTracked) return state;
      const knownTurns =
        known === undefined
          ? state.knownTurns
          : { ...state.knownTurns, [event.turnId]: { ...known, sessionId: event.sessionId } };
      return isTracked && state.trackedTurn !== null
        ? { ...state, knownTurns, trackedTurn: { ...state.trackedTurn, sessionId: event.sessionId } }
        : { ...state, knownTurns };
    }
    case "turn-ended": {
      const wasKnown = event.turnId in state.knownTurns;
      const isTracked = state.trackedTurn?.turnId === event.turnId;
      // Unrelated turns end constantly (every chat turn publishes one). Keep
      // the SAME reference when nothing about the overlay changed — the store
      // hands this straight to Vue, and a fresh object per event would rerender
      // for turns that have nothing to do with the desktop.
      if (!wasKnown && !isTracked) return state;
      // Drop the ended turn's metadata whether or not it was the tracked one,
      // so the lookup follows the turns that actually exist.
      const knownTurns = { ...state.knownTurns };
      delete knownTurns[event.turnId];
      // The tracked turn finished — stale narration must not float over the
      // desktop; the overlay hides immediately. This is also what makes the
      // chat's own Stop clear the overlay: interrupting the turn ends it.
      return isTracked
        ? { ...emptyDesktopActivity(), knownTurns }
        : { ...state, knownTurns };
    }
    default:
      return state;
  }
}

/** Continuous visibility: up while a desktop step runs or a desktop approval
 *  waits, and staying up until IDLE_HIDE_MS after the LAST desktop activity —
 *  so a multi-step sequence keeps it steady rather than flickering per step.
 *  (turn-ended clears the state, hiding it immediately.) */
export function isDesktopOverlayVisible(state: DesktopActivityState, nowMs: number): boolean {
  if (state.pendingApprovalIds.length > 0) return true;
  if (state.steps.some((step) => step.status === "running")) return true;
  return state.lastActivityAtMs !== null && nowMs - state.lastActivityAtMs < IDLE_HIDE_MS;
}
