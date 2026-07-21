import type { SessionActivityEvent } from "@vynel/contracts/chat/session-activity";

// The pure fold behind the desktop-control overlay: activity-feed events in,
// "what is Claude doing to the desktop right now" out. Only `mcp__desktop__*`
// steps count — a long global turn doing non-desktop work must not surface the
// overlay. Colocated with the store (desktop-activity-store.ts) that holds it;
// pure so the burst/linger visibility rule is unit-testable with a fake clock.

export const DESKTOP_TOOL_PREFIX = "mcp__desktop__";

/** How long the overlay lingers after the last desktop step settles. */
export const OVERLAY_LINGER_MS = 8_000;

const RECENT_STEP_LIMIT = 4;

export interface DesktopStep {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  status: "running" | "completed" | "failed" | "denied" | "cancelled";
}

export interface DesktopActivityState {
  /** The turn currently driving desktop steps — Stop targets it. */
  trackedTurn: { turnId: string; scopeKind: "global" | "workspace" } | null;
  /** Newest last, capped — the overlay shows the current + a few settled. */
  steps: DesktopStep[];
  /** Pending desktop approvals (bells; the approvals API owns the state). */
  pendingApprovalIds: string[];
  /** When the last desktop step settled (ms epoch) — drives the linger. */
  lastSettledAtMs: number | null;
}

export function emptyDesktopActivity(): DesktopActivityState {
  return { trackedTurn: null, steps: [], pendingApprovalIds: [], lastSettledAtMs: null };
}

function isDesktopTool(toolName: string): boolean {
  return toolName.startsWith(DESKTOP_TOOL_PREFIX);
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
      };
    }
    case "turn-tool-settled": {
      const index = state.steps.findIndex((step) => step.toolUseId === event.toolUseId);
      if (index === -1) return state;
      const steps = state.steps.slice();
      steps[index] = { ...steps[index]!, status: event.status };
      return { ...state, steps, lastSettledAtMs: nowMs };
    }
    case "turn-approval-requested": {
      if (!isDesktopTool(event.toolName)) return state;
      if (state.pendingApprovalIds.includes(event.approvalRequestId)) return state;
      return {
        ...state,
        trackedTurn: trackTurn(state, event.turnId),
        pendingApprovalIds: [...state.pendingApprovalIds, event.approvalRequestId],
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

/** The burst-based visibility rule: visible while a desktop step runs or a
 *  desktop approval waits, lingering OVERLAY_LINGER_MS past the last settle. */
export function isDesktopOverlayVisible(state: DesktopActivityState, nowMs: number): boolean {
  if (state.pendingApprovalIds.length > 0) return true;
  if (state.steps.some((step) => step.status === "running")) return true;
  return state.lastSettledAtMs !== null && nowMs - state.lastSettledAtMs < OVERLAY_LINGER_MS;
}
