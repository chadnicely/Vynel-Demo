import type { SessionEffectiveStatus } from "@vynel/contracts/chat/session-status";
import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";
import {
  isCompletedAndClear,
  isQueueWorking,
  type WorkspaceQueueSummary,
} from "../tasks/task-queue-summary.js";
import type { SceneNode } from "../../utils/constellation-scene.js";
import { isWithinActiveWindow } from "./use-active-window.js";

export interface FleetNodeStatusInput {
  /** A turn running in this workspace right now. */
  liveTurn: boolean;
  queue: WorkspaceQueueSummary | undefined;
  progress:
    | { done: number; total: number; lastWorkedAt: string | null }
    | undefined;
  nowMs: number;
}

// What colour one project's dot wears on the node screen.
//
// This is the NODE SCREEN'S OWN reading, not main's shared one. The navigation
// surfaces (tree rows, tab strip, work rail, chat header) all derive from
// `composables/workspaces/use-workspace-status.ts`, which reads approvals,
// asks and turn outcomes and can reach `problem`. This reads the task queue
// and the step dock, and never reaches `problem` — so a project whose last
// turn failed is red in the tree and grey out here. Merging the two changes
// visible colours, so it needs Chad; until then the divergence is real and
// named rather than pretended away.
export function resolveFleetNodeStatus(
  input: FleetNodeStatusInput,
): SceneNode["status"] {
  const { liveTurn, queue, progress, nowMs } = input;
  // A node only shows a LIVE status while the project is active — the same
  // hour-long window the sidebar uses to split Active from Not running (Chad,
  // 2026-08-12). This is what stops a dormant project with a stale in-progress
  // task from glowing "working" while it sits under NOT RUNNING.
  const workedRecently = isWithinActiveWindow(
    progress?.lastWorkedAt ?? null,
    nowMs,
  );
  if (!liveTurn && !workedRecently) return "idle";
  // Working = a live turn OR its queue running a task right now.
  if (liveTurn || isQueueWorking(queue)) return "building";
  // Finished and nothing left in the queue → the calmer "done" green.
  if (isCompletedAndClear(queue, progress)) return "done";
  // Otherwise it wants you — mid-build pause, or tasks queued but not running.
  return "waiting";
}

// What colour one CONVERSATION's dot wears, one level down — now a pure
// rename of main's REAL status ladder into the scene's palette (Move 3,
// 2026-08-17). It used to invent `waiting` from "spoke within the hour",
// which asserted the ball was in your court from the absence of evidence
// (the recorded `nodes-screen-invents-needs-you` bug). The caller passes the
// derived status instead: a session's (`deriveSessionStatus` — live turn,
// pending approval, the assistant's own set state, the last error) or, for a
// room's continuing build, the workspace's (`use-workspace-status`) — so a
// dot here and the row in the tree can never disagree.
//
// The FLEET dots above keep their own queue-based reading
// (`resolveFleetNodeStatus`) until Chad merges the two vocabularies.
export function resolveConversationNodeStatus(
  status: SessionEffectiveStatus | WorkspaceEffectiveStatus,
): SceneNode["status"] {
  switch (status) {
    case "running":
      return "building";
    case "needs_input":
      return "waiting";
    case "problem":
      return "problem";
    case "completed":
      return "done";
    // 'idle' (a conversation) / 'not_running' (a room) — one quiet grey.
    default:
      return "idle";
  }
}
