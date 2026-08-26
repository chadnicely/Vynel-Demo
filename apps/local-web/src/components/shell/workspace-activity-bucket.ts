import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";

// The sidebar's top-level split — Active Projects / Not running (Chad,
// 2026-08-24) — read straight off the ONE status each row already wears
// (Kafi, 2026-08-27: "filter them with the state we already have"). No clock,
// no "worked in the last hour": running, waiting on you, or stuck is active;
// idle and done are not running.
export type WorkspaceActivityBucket = "active" | "not-running";

/** A row whose status has not landed yet reads as active — it must not
 *  flicker down into Not running and back while the first poll answers. */
export function activityBucketOfStatus(
  status: WorkspaceEffectiveStatus | null,
): WorkspaceActivityBucket {
  if (status === "not_running" || status === "completed") return "not-running";
  return "active";
}

/** A group is never split across sections: it follows its liveliest member.
 *  An empty group stays where it was made — under Active, ready to be filled. */
export function groupActivityBucket(
  memberBuckets: readonly WorkspaceActivityBucket[],
): WorkspaceActivityBucket {
  if (memberBuckets.length === 0) return "active";
  return memberBuckets.includes("active") ? "active" : "not-running";
}
