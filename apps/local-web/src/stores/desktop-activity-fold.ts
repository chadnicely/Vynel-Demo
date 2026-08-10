import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";
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

export interface DesktopActivityState {
  /** The turn currently driving desktop steps — Stop targets it. */
  trackedTurn: { turnId: string; scopeKind: "global" | "workspace" } | null;
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

function trackTurn(
  state: DesktopActivityState,
  turnId: string,
): DesktopActivityState["trackedTurn"] {
  // Desktop tools ride the global root today; scopeKind stays 'global' unless a
  // turn-started ever taught us otherwise (the feed carries no scope on steps).
  return state.trackedTurn?.turnId === turnId ? state.trackedTurn : { turnId, scopeKind: "global" };
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
      // Cap by evicting the oldest SETTLED step first — evicting a running one
      // would drop it from the visibility check and orphan its later settle
      // (the overlay could hide mid-operation).
      const steps = [...state.steps, step];
      if (steps.length > RECENT_STEP_LIMIT) {
        const evictIndex = steps.findIndex((candidate) => candidate.status !== "running");
        steps.splice(evictIndex === -1 ? 0 : evictIndex, 1);
      }
      return {
        ...state,
        trackedTurn: trackTurn(state, event.turnId),
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
      return {
        ...state,
        trackedTurn: trackTurn(state, event.turnId),
        pendingApprovalIds: [...state.pendingApprovalIds, event.approvalRequestId],
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
    case "turn-ended":
      // The tracked turn finished — stale narration must not float over the
      // desktop; the overlay hides immediately.
      if (state.trackedTurn?.turnId !== event.turnId) return state;
      return emptyDesktopActivity();
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
