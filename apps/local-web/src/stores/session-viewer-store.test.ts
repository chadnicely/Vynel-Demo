import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSessionViewerStore } from "./session-viewer-store.js";
import { useLiveSessionsStore } from "./live-sessions-store.js";

describe("session-viewer store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("open starts a fresh stack; drillDown pushes; back pops; close clears", () => {
    const viewer = useSessionViewerStore();

    viewer.open("workspace-session");
    expect(viewer.isOpen).toBe(true);
    expect(viewer.currentSessionId).toBe("workspace-session");
    expect(viewer.canGoBack).toBe(false);

    viewer.drillDown("agent-session");
    expect(viewer.currentSessionId).toBe("agent-session");
    expect(viewer.canGoBack).toBe(true);

    viewer.back();
    expect(viewer.currentSessionId).toBe("workspace-session");

    viewer.open("other-session");
    expect(viewer.stack).toEqual(["other-session"]);

    viewer.close();
    expect(viewer.isOpen).toBe(false);
  });

  it("ignores re-opening the session already on top", () => {
    const viewer = useSessionViewerStore();

    viewer.open("s1");
    viewer.drillDown("s2");
    viewer.drillDown("s2");

    expect(viewer.stack).toEqual(["s1", "s2"]);
  });
});

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

    expect(live.liveFor("s1")?.text).toBe("hi there");

    live.end("s1");
    expect(live.liveFor("s1")).toBeNull();
  });

  it("ignores events for unregistered sessions", () => {
    const live = useLiveSessionsStore();

    live.ingest("ghost", { kind: "turn-stream-ended" });

    expect(live.liveFor("ghost")).toBeNull();
  });
});
