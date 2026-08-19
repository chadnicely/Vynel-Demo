import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";
import type { SessionEffectiveStatus } from "@vynel/contracts/chat/session-status";

// The shell's GLOBAL light covers the whole global area — the assistant
// thread and the spoken thread under it (D7: voice is a child of global).
//
// This is NOT a third derivation home. `deriveSessionStatus` (per
// conversation) and `deriveView` (per room) stay the only two; the voice
// status and the global status arrive here already derived. All this does is
// pick the more urgent of two ladder values, on the app's one precedence:
// problem → needs_input → running → completed → not_running. So a voice turn
// that failed, or one parked on a card, reddens the Global row even while the
// typed thread is quiet — before this it lit nothing anywhere.

const RANK: Record<WorkspaceEffectiveStatus, number> = {
  problem: 0,
  needs_input: 1,
  running: 2,
  completed: 3,
  not_running: 4,
};

/** The session ladder's `idle` is the room ladder's `not_running` — the same
 *  state under two surfaces' names. */
function asAreaStatus(status: SessionEffectiveStatus): WorkspaceEffectiveStatus {
  return status === "idle" ? "not_running" : status;
}

export function foldGlobalAreaStatus(
  globalStatus: WorkspaceEffectiveStatus,
  voiceStatus: SessionEffectiveStatus | null,
): WorkspaceEffectiveStatus {
  if (voiceStatus === null) return globalStatus;
  const voice = asAreaStatus(voiceStatus);
  return RANK[voice] < RANK[globalStatus] ? voice : globalStatus;
}
