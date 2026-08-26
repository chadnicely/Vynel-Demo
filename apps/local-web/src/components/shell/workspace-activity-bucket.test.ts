import { describe, expect, it } from "vitest";
import { activityBucketOfStatus, groupActivityBucket } from "./workspace-activity-bucket.js";

describe("activityBucketOfStatus", () => {
  it("running, waiting on you, or stuck is active", () => {
    expect(activityBucketOfStatus("running")).toBe("active");
    expect(activityBucketOfStatus("needs_input")).toBe("active");
    expect(activityBucketOfStatus("problem")).toBe("active");
  });

  it("idle and done are not running", () => {
    expect(activityBucketOfStatus("not_running")).toBe("not-running");
    expect(activityBucketOfStatus("completed")).toBe("not-running");
  });

  it("a status that has not landed yet reads as active — no flicker", () => {
    expect(activityBucketOfStatus(null)).toBe("active");
  });
});

describe("groupActivityBucket", () => {
  it("follows the liveliest member — one active member keeps the whole group active", () => {
    expect(groupActivityBucket(["not-running", "active", "not-running"])).toBe("active");
  });

  it("is not running only when every member is", () => {
    expect(groupActivityBucket(["not-running", "not-running"])).toBe("not-running");
  });

  it("an empty group stays where it was made", () => {
    expect(groupActivityBucket([])).toBe("active");
  });
});
