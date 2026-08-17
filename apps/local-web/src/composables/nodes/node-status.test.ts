// The node screen's palette rename. Both levels of the screen — the fleet's
// project dots and a project's conversation dots — now pass through here, so
// this is the only place the scene's vocabulary meets the app's.
//
// test: correct expectation for the FLEET dots — was a queue+activity-window
// ladder with four states, now the shared status rename. The old spec pinned
// `waiting` as an ELSE branch ("worked recently but mid-build is waiting on
// you"), which is precisely the recorded `nodes-screen-invents-needs-you`
// defect: need asserted from the absence of evidence. Waiting now requires a
// positive fact, and the derivation that produces it is pinned in
// `use-workspace-status` / `deriveSessionStatus`.

import { describe, expect, it } from "vitest";
import { resolveNodeStatus } from "./node-status.js";

describe("resolveNodeStatus", () => {
  it("renames a session's status into the scene's palette", () => {
    expect(resolveNodeStatus("running")).toBe("building");
    expect(resolveNodeStatus("needs_input")).toBe("waiting");
    expect(resolveNodeStatus("problem")).toBe("problem");
    expect(resolveNodeStatus("completed")).toBe("done");
    expect(resolveNodeStatus("idle")).toBe("idle");
  });

  // A project dot ("The build", and now every fleet dot) passes the ROOM's
  // status — the same ladder, one extra name for quiet.
  it("accepts a workspace status too — not_running is the same quiet grey", () => {
    expect(resolveNodeStatus("not_running")).toBe("idle");
    expect(resolveNodeStatus("problem")).toBe("problem");
  });

  // The two colours the fleet's old window-based reading could never produce:
  // it had no `problem` at all, and its `waiting` came from a fallback rather
  // than from anything actually pending.
  it("reaches problem, which the old fleet reading could not", () => {
    expect(resolveNodeStatus("problem")).not.toBe("idle");
    expect(resolveNodeStatus("problem")).not.toBe("waiting");
  });

  it("an active project with nothing pending is idle, never waiting", () => {
    expect(resolveNodeStatus("not_running")).not.toBe("waiting");
    expect(resolveNodeStatus("completed")).not.toBe("waiting");
    expect(resolveNodeStatus("running")).not.toBe("waiting");
  });
});
