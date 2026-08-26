import type { WorkspaceEffectiveStatus } from "@vynel/contracts/workspaces/workspace-status";

// The sidebar's top-level split — Needs setup / Active Projects / Not running
// (Chad, 2026-08-24) — read straight off what each row already carries (Kafi,
// 2026-08-27: "filter them with the state we already have"). No clock: a
// project that has not been through "Finish setting up" (`setupCompletedAt`
// null) needs setup; otherwise running / waiting on you / stuck is active,
// and idle / done is not running.
export type WorkspaceActivityBucket = "needs-setup" | "active" | "not-running";

/** A row whose status has not landed yet reads as active — it must not
 *  flicker down into Not running and back while the first poll answers.
 *  (The needs-setup tier is decided by `setupCompletedAt`, in the tree — see
 *  `bucketOf` — because it beats status.) */
export function activityBucketOfStatus(
  status: WorkspaceEffectiveStatus | null,
): WorkspaceActivityBucket {
  if (status === "not_running" || status === "completed") return "not-running";
  return "active";
}

/** A group is never split across sections: it follows its liveliest member,
 *  in the order needs-setup > active > not-running (a group with one project
 *  still needing setup surfaces there). An empty group stays under Active. */
export function groupActivityBucket(
  memberBuckets: readonly WorkspaceActivityBucket[],
): WorkspaceActivityBucket {
  if (memberBuckets.length === 0) return "active";
  if (memberBuckets.includes("needs-setup")) return "needs-setup";
  return memberBuckets.includes("active") ? "active" : "not-running";
}
