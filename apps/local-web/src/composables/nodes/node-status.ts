import type { SessionEffectiveStatus } from "@vynel/contracts/chat/session-status";
import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";
import type { SceneNode } from "../../utils/constellation-scene.js";

// What colour one dot wears on the node screen — a PURE RENAME of the app's
// real status into the scene's palette, and nothing more.
//
// ONE RULE EVERYWHERE (Kafi, 2026-08-17). Both levels of this screen now read
// the same derivations every other surface reads — the fleet dots take a
// workspace's status from `use-workspace-status`, the conversation dots take a
// session's from `deriveSessionStatus`. Neither invents anything here.
//
// What this replaced is worth remembering: the fleet dots used to run their
// own ladder over the task queue and an hour-long activity window, where
// `waiting` was the ELSE branch. That made "NEEDS YOU" mean *"this project
// spoke recently and I have nothing else to say about it"* — need asserted
// from the absence of evidence, on the one screen named for showing you what
// needs you. It also could never reach `problem`, so a project whose last turn
// failed was red in the sidebar and grey out here.
//
// Waiting now requires a positive fact (a pending approval, a pending
// question, or the assistant setting the state itself) and red requires a real
// failure. A project that is simply active with nothing pending reads `idle` —
// see NodesFleetBar for how that is worded.
export function resolveNodeStatus(
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
