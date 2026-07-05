import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSessionViewerStore } from "./session-viewer-store.js";
import { useLiveSessionsStore } from "./live-sessions-store.js";

describe("session-viewer store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("open sets the watched delegation; open replaces it; close clears", () => {
    const viewer = useSessionViewerStore();

    expect(viewer.isOpen).toBe(false);

    viewer.open("partial-1");
    expect(viewer.isOpen).toBe(true);
    expect(viewer.currentSessionId).toBe("partial-1");

    viewer.open("partial-2");
    expect(viewer.currentSessionId).toBe("partial-2");

    viewer.close();
    expect(viewer.isOpen).toBe(false);
    expect(viewer.currentSessionId).toBeNull();
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
