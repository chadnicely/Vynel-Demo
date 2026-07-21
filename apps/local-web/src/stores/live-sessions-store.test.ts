import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useLiveSessionsStore } from "./live-sessions-store.js";

// Moved out of session-viewer-store.test.ts when that store collapsed into the
// activity-monitor stack (Slice ②) — the live-sessions fold is untouched.
describe("live-sessions store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("begin registers a view, ingest folds events, end removes it", () => {
    const live = useLiveSessionsStore();

    live.begin("s1");
    live.ingest("s1", {
      kind: "text-chunk",
      messageId: "m1",
      textDelta: "hi ",
    });
    live.ingest("s1", {
      kind: "text-chunk",
      messageId: "m1",
      textDelta: "there",
    });

    // test: correct expectation — the view is segmented by assistant message
    // now (live/settled layout parity); the fold lands in m1's segment.
    expect(live.liveFor("s1")?.segments[0]?.text).toBe("hi there");

    live.end("s1");
    expect(live.liveFor("s1")).toBeNull();
  });

  it("ignores events for unregistered sessions", () => {
    const live = useLiveSessionsStore();

    live.ingest("ghost", { kind: "turn-stream-ended" });

    expect(live.liveFor("ghost")).toBeNull();
  });
});
