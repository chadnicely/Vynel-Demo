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

export interface ConversationNodeStatusInput {
  /** A turn running on THIS conversation right now. Asked per session, never
   *  per workspace: a spawned session's turn is workspace-scoped too, so a
   *  workspace-wide check lights every dot in the room instead of the one that
   *  is actually running. */
  hasLiveTurn: boolean;
  /** When it last spoke; null until it has. */
  lastMessageAt: string | null;
  nowMs: number;
}

// What colour one CONVERSATION's dot wears, one level down. Deliberately the
// same three readings and the same hour as a project gets, so stepping inside
// a room shows the same picture rather than a different vocabulary: it is
// running, it spoke recently and the ball is in your court, or it is quiet.
//
// `done` is not reachable here — a conversation is never finished the way a
// task queue is drained.
export function resolveConversationNodeStatus(
  input: ConversationNodeStatusInput,
): SceneNode["status"] {
  if (input.hasLiveTurn) return "building";
  return isWithinActiveWindow(input.lastMessageAt, input.nowMs)
    ? "waiting"
    : "idle";
}
